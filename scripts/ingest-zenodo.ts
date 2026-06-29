// Zenodo ingester — the creative engine. Zenodo holds ~18k CC0/CC-BY tracking
// datasets across EVERY taxon (paper-supplement deposits). They're heterogeneous
// CSVs, so we fuzzy-detect: which file is the track, its delimiter, and which
// columns are lat/lon/time/individual. License-gated, resilient (skip what
// doesn't fit), gentle. Writes into the local PGlite DB.
//
// Usage: pnpm tsx scripts/ingest-zenodo.ts [limit] [pages]
import "dotenv/config";
import { sql } from "../db/index";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { normalizeLicense, isCommercialSafe, type License } from "../lib/licenses";
import type { RawPoint } from "../lib/track";

const MAX_FILE_BYTES = 40 * 1024 * 1024; // skip files bigger than 40 MB for now
const QUERY = "animal tracking telemetry GPS satellite Argos movement"; // space-separated = relevance match

// ---- fuzzy CSV parsing -------------------------------------------------------
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function detectDelim(headerLine: string): string {
  const counts = [",", "\t", ";"].map((d) => [d, headerLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function findCol(header: string[], match: (n: string) => boolean): number {
  return header.findIndex((h) => match(norm(h)));
}
function detectColumns(header: string[]) {
  const lat = findCol(header, (n) => /^(decimal)?lat(itude)?$/.test(n) || n === "locationlat" || n === "ylat" || n === "gpslatitude");
  const lon = findCol(header, (n) => /^(decimal)?lon(g)?(itude)?$/.test(n) || n === "locationlong" || n === "lng" || n === "gpslongitude");
  // time: exact good names first, then any column containing "date"/"time".
  let time = findCol(header, (n) => ["timestamp", "datetime", "eventdate", "date", "time", "studylocaltimestamp", "gpstime", "acquisitiontime", "dateloc", "datetimeutc"].includes(n));
  if (time < 0) time = findCol(header, (n) => (n.includes("date") || n.includes("time")) && !n.includes("update"));
  let id = findCol(header, (n) => ["individuallocalidentifier", "individualid", "individual", "animalid", "animal", "tagid", "taglocalidentifier", "tag", "organismid", "organism", "trackid", "birdid", "deployid", "deployment"].includes(n));
  if (id < 0) id = findCol(header, (n) => n.endsWith("id") || n === "name" || n.includes("identifier"));
  const sci = findCol(header, (n) => ["species", "scientificname", "taxon", "taxoncanonicalname", "individualtaxoncanonicalname"].includes(n));
  return { lat, lon, time, id, sci };
}

// binomial in title/keywords as a species fallback (e.g. "Aquila chrysaetos")
function speciesFromText(...texts: (string | undefined)[]): string | undefined {
  for (const t of texts) {
    const m = (t || "").match(/\b([A-Z][a-z]{2,})\s([a-z]{3,})\b/);
    if (m && !/^(The|This|Data|GPS|And|For|With|From)$/.test(m[1])) return `${m[1]} ${m[2]}`;
  }
  return undefined;
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`zenodo ${r.status}`);
  return r.json();
}

// Validate a candidate species name against GBIF's backbone so junk like
// "Random walk" / "Range for" / "LEYE" doesn't pollute the species count.
const speciesCache = new Map<string, string | null>();
async function validSpecies(name?: string): Promise<string | undefined> {
  const key = (name || "").trim();
  if (!key || key.length < 4) return undefined;
  if (speciesCache.has(key)) return speciesCache.get(key) ?? undefined;
  let val: string | null = null;
  try {
    const m = await (await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) })).json();
    if (m && m.matchType !== "NONE" && (m.rank === "SPECIES" || m.rank === "SUBSPECIES" || m.species)) val = m.species || m.scientificName || key;
  } catch { /* leave null */ }
  speciesCache.set(key, val);
  return val ?? undefined;
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
        const lat = Number(r[col.lat]), lon = Number(r[col.lon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const indId = (col.id >= 0 ? r[col.id] : "") || "ALL";
        let e = byInd.get(indId);
        if (!e) { e = { sci: col.sci >= 0 ? r[col.sci] : undefined, points: [] }; byInd.set(indId, e); }
        e.points.push({ ts: r[col.time], lon, lat });
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

function trackiness(name: string): number {
  return /track|gps|telemetr|argos|movement|reloc|location|\bfix/i.test(name) ? 1 : 0;
}

async function main() {
  const limit = Number(process.argv[2] || 30);
  const pages = Number(process.argv[3] || 5);
  console.log(`\n=== Zenodo ingest (limit ${limit}, up to ${pages} pages) ===\n`);

  // already-attempted zenodo records (idempotent across runs)
  const done = new Set((await sql`select id from datasets where source = 'zenodo'` as any).map((r: any) => r.id));

  let ingested = 0, gInd = 0, gPts = 0; const newSpecies = new Set<string>();
  for (let page = 1; page <= pages && ingested < limit; page++) {
    const q = `https://zenodo.org/api/records?q=${encodeURIComponent(QUERY)}&type=dataset&size=25&page=${page}`;
    let data: any;
    try { data = await fetchJson(q); } catch (e) { console.error(`  page ${page} failed: ${(e as Error).message}`); continue; }
    const hits: ZRecord[] = data.hits?.hits ?? [];
    if (!hits.length) break;

    for (const rec of hits) {
      if (ingested >= limit) break;
      if (done.has(`zenodo:${rec.id}`)) continue;
      try {
        const r = await ingestRecord(rec);
        if (r) {
          ingested++; gInd += r.individuals; gPts += r.points; if (r.species) newSpecies.add(r.species);
          console.log(`  ✓ ${(rec.metadata?.title || "").slice(0, 50)} → +${r.individuals} ind, +${r.points} pts ${r.species ? `[${r.species}]` : ""}`);
        }
      } catch (e) { /* skip */ }
      await new Promise((res) => setTimeout(res, 400)); // be polite to Zenodo
    }
  }
  console.log(`\n✓ Zenodo: ${ingested} datasets ingested · +${gInd} individuals · +${gPts} points · ${newSpecies.size} species seen`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
