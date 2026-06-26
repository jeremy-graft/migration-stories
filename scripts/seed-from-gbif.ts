// PHASE 2 — Seed one real CC0 animal via GBIF's public search (NO auth).
//
// 1. Resolve a CC0 dataset (arg or default candidate).
// 2. License gate (isCommercialSafe) — abort if not commercial-safe.
// 3. Facet individuals; pull each top candidate's FULL track; pick the most
//    migratory complete track.
// 4. Write datasets / individuals / track_points (idempotent re-seed).
// 5. Generate a draft story with cached, downsampled GeoJSON render artifact.
//
// Usage: pnpm seed-from-gbif [datasetKey]
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { datasets, individuals, trackPoints, stories } from "../db/schema";
import { gbifDataset, gbifTopOrganisms, gbifOccurrences, type GbifOccurrence } from "../lib/sources/gbif";
import { isCommercialSafe, normalizeLicense, type License } from "../lib/licenses";
import { reconstructTrack, type RawPoint, type TrackResult } from "../lib/track";
import { generateBeats, makeSlug } from "../lib/story";

// Curated CC0 candidates discovered during recon (INBO / LifeWatch, Movebank-published).
// Default = Eurasian spoonbill: named individuals, classic NW-Europe -> West Africa migration.
const DEFAULT_DATASET = "6850e626-46fd-4843-a391-2c06b069a940"; // SPOONBILL_VLAANDEREN

// English common names for our known candidates (GBIF vernacularName is often absent).
const COMMON_NAMES: Record<string, string> = {
  "Platalea leucorodia": "Eurasian spoonbill",
  "Larus fuscus": "Lesser black-backed gull",
  "Numenius arquata": "Eurasian curlew",
  "Circus aeruginosus": "Western marsh harrier",
  "Ichthyaetus melanocephalus": "Mediterranean gull",
  "Larus argentatus": "Herring gull",
};

// GBIF occurrence search degrades badly past ~10k offset (organismID queries
// time out around offset 12k), and the no-auth path can't use the download API.
// So we ingest only individuals whose ENTIRE track is pageable — yielding a
// COMPLETE track fast. Richer individuals are reachable via Phase 3 (auth).
const PAGEABLE_MAX = 8000;    // max total fixes we'll page without the download API
const MIN_FIXES = 800;        // facet floor — ignore sparsely-tracked individuals
const MAX_PULL = 6;           // how many pageable candidates to pull + compare
const MIN_POINTS = 200;       // min clean points to qualify as a story
const MIN_DAYS = 45;          // require a real seasonal span

function commonNameFor(scientificName?: string): string | undefined {
  if (!scientificName) return undefined;
  for (const [genusSpecies, common] of Object.entries(COMMON_NAMES)) {
    if (scientificName.startsWith(genusSpecies)) return common;
  }
  return undefined;
}

function toRawPoints(occ: GbifOccurrence[]): RawPoint[] {
  return occ.map((o) => ({ ts: o.eventDate, lon: o.decimalLongitude, lat: o.decimalLatitude }));
}

/** Migratory-ness score: latitude amplitude is the signal; points break ties. */
function score(t: TrackResult): number {
  return t.latSpanDeg * 1000 + Math.log10(t.pointCount + 1);
}

/** Evenly downsample a timeline to at most `max` points for the render artifact. */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1]; // always keep the last fix
  return out;
}

async function main() {
  const datasetKey = process.argv[2] || DEFAULT_DATASET;
  console.log(`\n=== Seed from GBIF (no auth) ===\nDataset: ${datasetKey}`);

  // 1 + 2. Metadata + license gate.
  const meta = await gbifDataset(datasetKey);
  const license: License = normalizeLicense(meta.license);
  console.log(`Title: ${meta.title}`);
  console.log(`License: ${meta.license}  ->  ${license}`);
  console.log(`DOI: ${meta.doi ?? "(none)"}`);
  if (!isCommercialSafe(license)) {
    console.error(`\n✗ License ${license} is NOT commercial-safe (ALLOW_NC=${process.env.ALLOW_NC}). Aborting.`);
    process.exit(1);
  }
  console.log("✓ License is commercial-safe.\n");

  // 3. Rank individuals; restrict to fully-pageable ones; pull each; pick most migratory.
  const facet = await gbifTopOrganisms(datasetKey, 15);
  console.log(`Individuals by fix count: ${facet.map((t) => `${t.id}(${t.count})`).join(", ")}`);
  const candidates = facet
    .filter((c) => c.count >= MIN_FIXES && c.count <= PAGEABLE_MAX)
    .slice(0, MAX_PULL);
  if (!candidates.length) {
    console.error(`\n✗ No fully-pageable individual (${MIN_FIXES}–${PAGEABLE_MAX} fixes) in this dataset.`);
    console.error("  Use the authenticated download API (Phase 3) for individuals with deeper tracks.");
    process.exit(1);
  }
  console.log(`Pageable candidates (≤${PAGEABLE_MAX} fixes): ${candidates.map((c) => `${c.id}(${c.count})`).join(", ")}\n`);

  let best: { organismID: string; track: TrackResult; sample: GbifOccurrence[] } | null = null;
  for (const cand of candidates) {
    process.stdout.write(`  pulling ${cand.id} (${cand.count} fixes) `);
    const occ: GbifOccurrence[] = [];
    for await (const o of gbifOccurrences(datasetKey, { organismID: cand.id, cap: PAGEABLE_MAX })) {
      occ.push(o);
      if (occ.length % 3000 === 0) process.stdout.write(".");
    }
    process.stdout.write(` ${occ.length} pulled\n`);
    const track = reconstructTrack(toRawPoints(occ));
    if (!track) { console.log(`  ${cand.id}: unusable (too few clean points)`); continue; }
    const ok = track.pointCount >= MIN_POINTS && track.durationDays >= MIN_DAYS;
    console.log(
      `  ${cand.id}: ${track.pointCount} pts, ${Math.round(track.durationDays)}d, ` +
      `latSpan ${track.latSpanDeg.toFixed(1)}°, ${Math.round(track.distanceKm)} km` +
      `${ok ? "" : "  (below thresholds)"}`,
    );
    if (!ok) continue;
    if (!best || score(track) > score(best.track)) best = { organismID: cand.id, track, sample: occ };
  }

  if (!best) {
    console.error("\n✗ No individual met the migratory thresholds. Try another dataset key.");
    process.exit(1);
  }

  const { organismID, track, sample } = best;
  const first = sample.find((o) => o.scientificName) ?? sample[0];
  const scientificName = first.scientificName?.replace(/\s+\S+,?\s*\d{4}.*$/, "").trim() || first.scientificName;
  const displayName = sample.find((o) => o.organismName)?.organismName || organismID;
  const commonName = commonNameFor(scientificName) || first.vernacularName;
  console.log(`\n★ Chosen: ${displayName} (${organismID}) — ${commonName ?? scientificName}`);
  console.log(`  ${track.pointCount} points · ${Math.round(track.distanceKm)} km · ` +
    `${track.trackStart.toISOString().slice(0, 10)} → ${track.trackEnd.toISOString().slice(0, 10)}`);

  // 4. Idempotent re-seed: clear any prior rows for this dataset (FK-safe order).
  const datasetId = `gbif:${datasetKey}`;
  const existing = await db.select({ id: individuals.id }).from(individuals).where(eq(individuals.datasetId, datasetId));
  if (existing.length) {
    const ids = existing.map((r) => r.id);
    await db.delete(stories).where(inArray(stories.individualId, ids));
    await db.delete(trackPoints).where(inArray(trackPoints.individualId, ids));
    await db.delete(individuals).where(eq(individuals.datasetId, datasetId));
    console.log(`  (cleared ${ids.length} prior individual(s) for re-seed)`);
  }
  await db.delete(datasets).where(eq(datasets.id, datasetId));

  await db.insert(datasets).values({
    id: datasetId,
    source: "gbif",
    title: meta.title,
    doi: meta.doi,
    license,
    citation: meta.citation,
    publisher: meta.publisher,
    taxa: scientificName ? [scientificName] : [],
    bbox: track.bbox,
    recordCount: track.points.length,
    raw: meta.raw as object,
  });

  const [ind] = await db.insert(individuals).values({
    datasetId,
    sourceIndividualId: organismID,
    name: displayName,
    scientificName,
    commonName,
    sex: first.sex,
    lifeStage: first.lifeStage,
    trackStart: track.trackStart,
    trackEnd: track.trackEnd,
    pointCount: track.pointCount,
    distanceKm: track.distanceKm,
    bbox: track.bbox,
    raw: { organismID, sampleKey: first.key } as object,
  }).returning({ id: individuals.id });

  // Insert all points (full resolution, outliers flagged) in chunks.
  const rows = track.points.map((p) => ({
    individualId: ind.id, ts: p.ts, lon: p.lon, lat: p.lat, visible: p.visible,
  }));
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(trackPoints).values(rows.slice(i, i + CHUNK));
  }
  console.log(`  wrote ${rows.length} track points`);

  // 5. Draft story + cached render artifact (downsampled timeline + simplified line).
  const speciesLabel = commonName ?? scientificName ?? "tracked animal";
  const slug = makeSlug(displayName, scientificName ?? organismID);
  const beats = generateBeats(track, displayName);
  const timeline = downsample(track.timeline, 2000);
  const geojson = {
    type: "FeatureCollection" as const,
    bbox: track.bbox,
    features: [track.simplified],
    properties: { timeline }, // [lon,lat,iso] for the animation driver
  };

  await db.insert(stories).values({
    individualId: ind.id,
    slug,
    title: `${displayName} the ${speciesLabel}`,
    dek: `${track.pointCount.toLocaleString()} GPS fixes across ${Math.round(track.distanceKm).toLocaleString()} km, ` +
      `${track.trackStart.toISOString().slice(0, 10)} to ${track.trackEnd.toISOString().slice(0, 10)}.`,
    beats,
    geojson,
    status: "draft",
  });

  console.log(`\n✓ Seeded story "/${slug}" (draft) with ${beats.length} beats.`);
  console.log(`  species: ${speciesLabel} · DOI: ${meta.doi ?? "—"} · license: ${license}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
