// USGS ScienceBase ingester — U.S. federal public-domain (CC0-equivalent) Argos
// & GPS tracking releases (waterfowl, shorebirds, seabirds, walrus, raptors…).
// Discovery via the ScienceBase catalog API (no auth); files are heterogeneous
// but USGS ASC releases share a schema (Animal_Species / Animal_ID /
// Location_Timestamp_UTC / Location_Lat_Solution_1 / Location_Lon_Solution_1),
// which we map explicitly with a generic fuzzy fallback. One file = many animals
// → group by Animal_ID. Species is IN the data, so no naming gap.
//
// Usage: pnpm tsx scripts/ingest-sciencebase.ts [limit]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { client } from "../db/index";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { detectColumns, detectDelim, validSpecies } from "../lib/csv-tracks";
import type { RawPoint } from "../lib/track";

const SB = "https://www.sciencebase.gov/catalog/items";
const CAP = 150 * 1024 * 1024;               // skip files bigger than 150 MB
const TERMS = ["argos", "telemetry", "tracking", "satellite", "movement", "gps", "ptt", "geolocator"];

const ATT_FILE = fileURLToPath(new URL("../sciencebase-attempted.json", import.meta.url));
const loadAttempted = (): Set<string> => { try { return new Set(JSON.parse(readFileSync(ATT_FILE, "utf8"))); } catch { return new Set(); } };
const saveAttempted = (s: Set<string>) => { try { writeFileSync(ATT_FILE, JSON.stringify([...s])); } catch { /* ignore */ } };

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": "migration-stories/0.1", Accept: "application/json" }, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`sciencebase ${r.status}`);
  return r.json();
}

interface SBItem { id: string; title: string; files: any[]; tags: any[] }

// Merge multi-term searches (SB treats multi-word q as near-exact, so single
// terms cast the widest net), dedup by item id.
async function discover(): Promise<SBItem[]> {
  const byId = new Map<string, SBItem>();
  for (const term of TERMS) {
    try {
      const j = await fetchJson(`${SB}?q=${encodeURIComponent(term)}&format=json&max=100&fields=title,files,tags`);
      for (const it of j.items ?? []) if (it.id && !byId.has(it.id)) byId.set(it.id, { id: it.id, title: it.title || "", files: it.files ?? [], tags: it.tags ?? [] });
    } catch (e) { console.error(`  discover "${term}" failed: ${(e as Error).message}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  return [...byId.values()];
}

const TRACKISH = /track|telemetr|argos|gps|satellite|movement|migrat|geolocat|\bptt\b|location/i;
function isTrackingItem(it: SBItem): boolean {
  const dataFiles = it.files.filter((f) => /\.(csv|txt|tsv)$/i.test(f.name || "") && !/readme|metadata|dictionary|version|\.xml/i.test(f.name || ""));
  if (!dataFiles.length) return false;
  const tagStr = it.tags.map((t: any) => t.name || t.type || "").join(" ").toLowerCase();
  const animalTag = /vertebrate|bird|mammal|fish|migration|animal|wildlife|reptile|amphibian/.test(tagStr);
  return animalTag || TRACKISH.test(it.title) || dataFiles.some((f) => TRACKISH.test(f.name));
}

function candidateFiles(it: SBItem): any[] {
  return it.files
    .filter((f) => /\.(csv|txt|tsv)$/i.test(f.name || "") && (f.size || 0) > 200 && (f.size || 0) <= CAP && !/readme|metadata|dictionary|version|\.xml/i.test(f.name || ""))
    .sort((a, b) => (trackFileScore(b.name) - trackFileScore(a.name)) || ((b.size || 0) - (a.size || 0)));
}
const trackFileScore = (n = "") => (/tabular|location|argos|gps|track|reloc|filter|clean|solution/i.test(n) ? 1 : 0);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// USGS-known columns first (Solution_1 = primary Argos position), generic fallback.
function mapColumns(header: string[]) {
  const H = header.map(norm);
  const idx = (names: string[]) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  let lat = idx(["locationlatsolution1", "latitude", "lat", "decimallatitude", "ylat", "gpslatitude"]);
  let lon = idx(["locationlonsolution1", "longitude", "lon", "long", "decimallongitude", "gpslongitude"]);
  let time = idx(["locationtimestamputc", "timestamp", "datetime", "acquisitiontime", "gpstime", "datetimeutc"]);
  let id = idx(["animalid", "pttid", "deployid", "individualid", "individuallocalidentifier", "tagid", "animal"]);
  let sci = idx(["animalspecies", "species", "scientificname", "taxon", "taxonname"]);
  const lc = idx(["locationclass", "argoslocationclass", "locationquality", "lc", "locationclasssolution1"]);
  if (lat < 0 || lon < 0 || time < 0) { // fuzzy fallback for non-USGS layouts
    const g = detectColumns(header);
    if (lat < 0) lat = g.lat; if (lon < 0) lon = g.lon; if (time < 0) time = g.time;
    if (id < 0) id = g.id; if (sci < 0) sci = g.sci;
  }
  return { lat, lon, time, id, sci, lc };
}

// quote-aware split of ONE line (USGS data files have no embedded newlines)
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []; let f = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { out.push(f); f = ""; }
    else f += c;
  }
  out.push(f);
  return out;
}

async function ingestItem(it: SBItem): Promise<{ individuals: number; points: number; species: string[] } | null> {
  for (const f of candidateFiles(it).slice(0, 2)) {
    try {
      const res = await fetch(f.url, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(180000) });
      if (!res.ok) continue;
      const text = await res.text();
      const nl = text.indexOf("\n");
      if (nl < 0) continue;
      const delim = detectDelim(text.slice(0, nl));
      const header = splitLine(text.slice(0, nl).replace(/\r$/, ""), delim);
      const col = mapColumns(header);
      if (col.lat < 0 || col.lon < 0 || col.time < 0) continue;

      // iterate lines directly (avoid materializing the whole matrix — files hit 87 MB)
      const byInd = new Map<string, { sci?: string; points: RawPoint[] }>();
      let start = nl + 1;
      for (let i = start; i <= text.length; i++) {
        if (i !== text.length && text[i] !== "\n") continue;
        const line = text.slice(start, i).replace(/\r$/, ""); start = i + 1;
        if (!line) continue;
        const r = splitLine(line, delim);
        const lat = Number(r[col.lat]), lon = Number(r[col.lon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (col.lc >= 0 && r[col.lc] === "Z") continue;
        const indId = (col.id >= 0 && r[col.id]?.trim()) || "ALL";
        let e = byInd.get(indId);
        if (!e) { e = { sci: col.sci >= 0 ? r[col.sci]?.trim() : undefined, points: [] }; byInd.set(indId, e); }
        e.points.push({ ts: r[col.time], lon, lat });
      }
      if (!byInd.size) continue;

      // resolve species: per-dataset distinct sci values (GBIF-validated, cached)
      const speciesOut = new Set<string>();
      const inds: IndividualInput[] = [];
      for (const [id, v] of byInd) {
        const sci = await validSpecies(v.sci);
        if (sci) speciesOut.add(sci);
        inds.push({ sourceIndividualId: id, name: id, scientificName: sci, points: v.points, raw: { sciencebase: it.id, file: f.name } });
      }
      const summary = await ingestTracks({
        id: `usgs:${it.id}`, source: "usgs",
        title: (it.title || `USGS ${it.id}`).slice(0, 300), license: "CC0_1_0", // U.S. federal public domain
        citation: "USGS / U.S. federal public domain (ScienceBase).", publisher: "USGS ScienceBase",
        raw: { sciencebase: it.id, file: f.name } as object,
      }, inds);
      if (summary.individualsWritten > 0) return { individuals: summary.individualsWritten, points: summary.pointsWritten, species: [...speciesOut] };
    } catch { /* try next file */ }
  }
  return null;
}

async function main() {
  const limit = Number(process.argv[2] || 500);
  await client.exec(`ALTER TYPE "source" ADD VALUE IF NOT EXISTS 'usgs'`);

  console.log("Discovering ScienceBase tracking items…");
  const all = await discover();
  const items = all.filter(isTrackingItem);
  console.log(`Found ${all.length} items, ${items.length} look like animal tracking with data files.\n`);

  const attempted = loadAttempted();
  let ingested = 0, gInd = 0, gPts = 0; const species = new Set<string>();
  for (const it of items) {
    if (ingested >= limit) break;
    if (attempted.has(it.id)) continue;
    attempted.add(it.id);
    try {
      const r = await ingestItem(it);
      if (r) {
        ingested++; gInd += r.individuals; gPts += r.points; r.species.forEach((s) => species.add(s));
        console.log(`  ✓ ${it.title.slice(0, 50)} → +${r.individuals} ind, +${r.points} pts ${r.species.length ? `[${r.species.slice(0, 2).join(", ")}]` : ""}`);
      }
    } catch (e) { console.log(`  ✗ ${it.title.slice(0, 50)}: ${(e as Error).message}`); }
    if (attempted.size % 10 === 0) saveAttempted(attempted);
    await new Promise((res) => setTimeout(res, 300));
  }
  saveAttempted(attempted);
  console.log(`\n✓ ScienceBase run: ${ingested} datasets · +${gInd} individuals · +${gPts} points · ${species.size} species this run`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
