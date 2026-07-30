// Zenodo ingester — the creative engine. Zenodo holds ~18k CC0/CC-BY tracking
// datasets across EVERY taxon (paper-supplement deposits). They're heterogeneous
// CSVs, so we fuzzy-detect: which file is the track, its delimiter, and which
// columns are lat/lon/time/individual. License-gated, resilient (skip what
// doesn't fit), gentle. Writes into the local PGlite DB.
//
// Usage: pnpm tsx scripts/ingest-zenodo.ts [limit] [pages]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { normalizeLicense, isCommercialSafe, type License } from "../lib/licenses";
import type { RawPoint } from "../lib/track";
import {
  parseDelimited, detectDelim, detectColumns, trackiness, speciesFromText, validSpecies, toNum, normalizeTs,
} from "../lib/csv-tracks";

const MAX_FILE_BYTES = 40 * 1024 * 1024; // skip files bigger than 40 MB for now
// Many relevance-ranked queries cover far more of Zenodo's ~18k tracking
// datasets than one query's deep (low-relevance) pages. Attempted-set dedupes.
const QUERIES = [
  "animal tracking telemetry GPS", "bird GPS tracking movement",
  "seabird satellite tracking foraging", "sea turtle satellite tracking",
  "shark ray satellite tag tracking", "mammal GPS collar movement",
  "Argos satellite telemetry animal", "raptor eagle migration tracking GPS",
  "waterbird waterfowl tracking GPS", "ungulate deer elk GPS collar movement",
  "marine mammal seal whale tracking", "penguin tracking foraging trip",
  "bat tracking movement telemetry", "reptile lizard snake tracking movement",
  "songbird passerine geolocator migration", "stork crane goose tracking migration",
  "carnivore wolf fox GPS tracking", "primate movement GPS tracking",
];

// Persist every Zenodo record id we attempt (yielded or not) so resumes skip
// them cheaply — before any download — instead of re-scanning from page 1.
const ATT_FILE = fileURLToPath(new URL("../zenodo-attempted.json", import.meta.url));
const loadAttempted = (): Set<number> => { try { return new Set(JSON.parse(readFileSync(ATT_FILE, "utf8"))); } catch { return new Set(); } };
const saveAttempted = (s: Set<number>) => { try { writeFileSync(ATT_FILE, JSON.stringify([...s])); } catch { /* ignore */ } };

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`zenodo ${r.status}`);
  return r.json();
}

interface ZRecord { id: number; metadata: any; files?: Array<{ key: string; size: number; links: { self: string } }> }

/** Try to ingest one Zenodo record. Returns {individuals, points} or null. */
async function ingestRecord(rec: ZRecord): Promise<{ individuals: number; points: number; species?: string } | null> {
  const license: License = normalizeLicense(rec.metadata?.license?.id);
  if (!isCommercialSafe(license)) return null;

  // Candidate files: CSV/TSV/TXT, not too big, not readme/metadata; track-ish first.
  const cands = (rec.files ?? [])
    .filter((f) => /\.(csv|tsv|txt)$/i.test(f.key) && f.size <= MAX_FILE_BYTES && f.size > 200 && !/readme|metadata|license|citation/i.test(f.key))
    .sort((a, b) => (trackiness(b.key) - trackiness(a.key)) || (b.size - a.size));
  if (!cands.length) return null;

  const titleSpecies = speciesFromText(rec.metadata?.title, ...(rec.metadata?.keywords ?? []));

  for (const f of cands.slice(0, 3)) {
    try {
      const res = await fetch(f.links.self, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) continue;
      const text = await res.text();
      const firstLine = text.slice(0, text.indexOf("\n"));
      const delim = detectDelim(firstLine);
      const rows = parseDelimited(text, delim);
      if (rows.length < 3) continue;
      const header = rows[0];
      const col = detectColumns(header);
      if (col.lat < 0 || col.lon < 0 || col.time < 0) continue; // not a track file

      const byInd = new Map<string, { sci?: string; points: RawPoint[] }>();
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const lat = toNum(r[col.lat]), lon = toNum(r[col.lon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const indId = (col.id >= 0 ? r[col.id] : "") || "ALL";
        let e = byInd.get(indId);
        if (!e) { e = { sci: col.sci >= 0 ? r[col.sci] : undefined, points: [] }; byInd.set(indId, e); }
        e.points.push({ ts: normalizeTs(r[col.time], col.time2 >= 0 ? r[col.time2] : undefined), lon, lat });
      }
      if (!byInd.size) continue;

      const species = await validSpecies([...byInd.values()][0]?.sci || titleSpecies);
      const individuals: IndividualInput[] = [...byInd.entries()].map(([id, v]) => ({
        sourceIndividualId: id, name: id, scientificName: species, points: v.points, raw: { zenodo: rec.id, file: f.key },
      }));
      const summary = await ingestTracks({
        id: `zenodo:${rec.id}`, source: "zenodo",
        title: (rec.metadata?.title || `Zenodo ${rec.id}`).slice(0, 300), license,
        doi: rec.metadata?.doi, citation: rec.metadata?.title, publisher: "Zenodo",
        raw: { zenodo: rec.id, file: f.key, doi: rec.metadata?.doi } as object,
      }, individuals);
      if (summary.individualsWritten > 0) return { individuals: summary.individualsWritten, points: summary.pointsWritten, species };
    } catch { /* try next file */ }
  }
  return null;
}


async function main() {
  const limit = Number(process.argv[2] || 500);          // max NEW datasets to ingest this run
  const pagesPerQuery = Number(process.argv[3] || 20);
  const attempted = loadAttempted();
  console.log(`=== Zenodo harvest (limit ${limit}, ${QUERIES.length} queries × ≤${pagesPerQuery} pages) ===`);
  console.log(`(${attempted.size} records already attempted — skipping)\n`);

  let ingested = 0, gInd = 0, gPts = 0; const newSpecies = new Set<string>();
  outer:
  for (const QUERY of QUERIES) {
    console.log(`\n— query: "${QUERY}"`);
    for (let page = 1; page <= pagesPerQuery; page++) {
      if (ingested >= limit) break outer;
      const q = `https://zenodo.org/api/records?q=${encodeURIComponent(QUERY)}&type=dataset&size=25&page=${page}`;
      let data: any;
      try { data = await fetchJson(q); } catch (e) { console.error(`  page ${page} failed: ${(e as Error).message}`); continue; }
      const hits: ZRecord[] = data.hits?.hits ?? [];
      if (!hits.length) break;
      for (const rec of hits) {
        if (ingested >= limit) break outer;
        if (attempted.has(rec.id)) continue; // skip before any download
        attempted.add(rec.id);
        try {
          const r = await ingestRecord(rec);
          if (r) {
            ingested++; gInd += r.individuals; gPts += r.points; if (r.species) newSpecies.add(r.species);
            console.log(`  ✓ ${(rec.metadata?.title || "").slice(0, 46)} → +${r.individuals} ind, +${r.points} pts ${r.species ? `[${r.species}]` : ""}`);
          }
        } catch (e) { /* skip */ }
        if (attempted.size % 25 === 0) saveAttempted(attempted);
        await new Promise((res) => setTimeout(res, 200));
      }
    }
  }
  saveAttempted(attempted);
  console.log(`\n✓ Zenodo run: ${ingested} datasets · +${gInd} individuals · +${gPts} points · ${newSpecies.size} species this run`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
