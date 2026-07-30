// ATN ingester — NOAA/IOOS Animal Telemetry Network, the marine gap-filler.
// ERDDAP serves ~403 per-animal satellite/Argos TRAJECTORY datasets (seals,
// whales, turtles, sharks, seabirds) as standardized CF tables — no auth, no
// fuzzy CSV: every dataset exposes time/latitude/longitude + taxon_name + animal.
// Data are U.S. federal public domain (NOAA "free to use and redistribute"
// disclaimer) → treated as CC0. This is the cleanest source we harvest.
//
// Usage: pnpm tsx scripts/ingest-atn.ts [limit]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { client } from "../db/index";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { parseDelimited } from "../lib/csv-tracks";
import type { RawPoint } from "../lib/track";

const A = "https://atn.ioos.us/erddap";
const ATT_FILE = fileURLToPath(new URL("../atn-attempted.json", import.meta.url));
const loadAttempted = (): Set<string> => { try { return new Set(JSON.parse(readFileSync(ATT_FILE, "utf8"))); } catch { return new Set(); } };
const saveAttempted = (s: Set<string>) => { try { writeFileSync(ATT_FILE, JSON.stringify([...s])); } catch { /* ignore */ } };

async function fetchText(url: string, timeout = 90000): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`atn ${r.status}`);
  return r.text();
}

interface ATNds { id: string; title: string }

async function listTrajectoryDatasets(): Promise<ATNds[]> {
  const j = JSON.parse(await fetchText(`${A}/tabledap/allDatasets.json?datasetID,title,cdm_data_type`, 60000));
  const cols: string[] = j.table.columnNames; const ci = (n: string) => cols.indexOf(n);
  return (j.table.rows as any[][])
    .filter((r) => r[ci("cdm_data_type")] === "Trajectory")
    .map((r) => ({ id: r[ci("datasetID")], title: String(r[ci("title")] || "") }));
}

async function ingestDataset(ds: ATNds): Promise<{ individuals: number; points: number; species?: string } | null> {
  // Argos/GPS fixes for the tagged animal(s). qartod_location_flag: 1 good, 2 not
  // evaluated, 3 suspect, 4 fail, 9 missing → drop 4/9. location_class "Z" = Argos
  // invalid → drop. reconstructTrack still speed-flags the rest.
  const cols = "time,latitude,longitude,taxon_name,animal,ptt,location_class,qartod_location_flag";
  const text = await fetchText(`${A}/tabledap/${ds.id}.csv?${encodeURIComponent(cols).replace(/%2C/g, ",")}`);
  const rows = parseDelimited(text, ",");
  if (rows.length < 4) return null; // header + units + ≥2 data rows
  const h = rows[0]; const c = (n: string) => h.indexOf(n);
  const cTime = c("time"), cLat = c("latitude"), cLon = c("longitude"),
    cTax = c("taxon_name"), cAnimal = c("animal"), cPtt = c("ptt"),
    cLc = c("location_class"), cQf = c("qartod_location_flag");

  const byInd = new Map<string, { sci?: string; points: RawPoint[] }>();
  let species: string | undefined;
  for (let i = 2; i < rows.length; i++) { // skip header(0) + units(1)
    const r = rows[i];
    const lat = Number(r[cLat]), lon = Number(r[cLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (cLc >= 0 && r[cLc] === "Z") continue;
    if (cQf >= 0 && (r[cQf] === "4" || r[cQf] === "9")) continue;
    const tax = cTax >= 0 ? (r[cTax] || "").trim() : "";
    if (tax && !species) species = tax;
    const id = (cAnimal >= 0 && r[cAnimal]?.trim()) || (cPtt >= 0 && r[cPtt]?.trim()) || ds.id;
    let e = byInd.get(id);
    if (!e) { e = { sci: tax || undefined, points: [] }; byInd.set(id, e); }
    e.points.push({ ts: r[cTime], lon, lat });
  }
  if (!byInd.size) return null;

  const individuals: IndividualInput[] = [...byInd.entries()].map(([id, v]) => ({
    sourceIndividualId: id, name: id, scientificName: v.sci || species, points: v.points, raw: { atn: ds.id },
  }));
  const summary = await ingestTracks({
    id: `atn:${ds.id}`, source: "atn",
    title: (ds.title || ds.id).slice(0, 300), license: "CC0_1_0", // U.S. federal public domain
    citation: "NOAA/IOOS Animal Telemetry Network — data free to use and redistribute (U.S. public domain).",
    publisher: "ATN (NOAA/IOOS)", raw: { atn: ds.id } as object,
  }, individuals);
  return summary.individualsWritten > 0
    ? { individuals: summary.individualsWritten, points: summary.pointsWritten, species }
    : null;
}

async function main() {
  const limit = Number(process.argv[2] || 500);
  // ensure the enum value exists (schema.ts adds it too; this makes the DB agree)
  await client.exec(`ALTER TYPE "source" ADD VALUE IF NOT EXISTS 'atn'`);

  const datasets = await listTrajectoryDatasets();
  const attempted = loadAttempted();
  console.log(`=== ATN harvest: ${datasets.length} trajectory datasets (${attempted.size} already attempted) ===\n`);

  let ingested = 0, gInd = 0, gPts = 0; const species = new Set<string>();
  for (const ds of datasets) {
    if (ingested >= limit) break;
    if (attempted.has(ds.id)) continue;
    attempted.add(ds.id);
    try {
      const r = await ingestDataset(ds);
      if (r) {
        ingested++; gInd += r.individuals; gPts += r.points; if (r.species) species.add(r.species);
        console.log(`  ✓ ${ds.id.slice(0, 46)} → +${r.individuals} ind, +${r.points} pts ${r.species ? `[${r.species}]` : ""}`);
      }
    } catch (e) { console.log(`  ✗ ${ds.id.slice(0, 46)}: ${(e as Error).message}`); }
    if (attempted.size % 20 === 0) saveAttempted(attempted);
    await new Promise((res) => setTimeout(res, 300));
  }
  saveAttempted(attempted);
  console.log(`\n✓ ATN run: ${ingested} datasets · +${gInd} individuals · +${gPts} points · ${species.size} species this run`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
