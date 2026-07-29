// PANGAEA ingester — georeferenced earth/enviro/biodiversity repository with a
// slice of animal-movement datasets (AWI seal/penguin/seabird tracking etc.).
// MIXED per-dataset licensing → we read the License line from each dataset's
// metadata header and gate on CC0/CC-BY (NC only if ALLOW_NC). Data comes as a
// PANGAEA "textfile": a `/* … */` metadata block then a TAB table. Many hits are
// derived products (maps/models) not per-fix tracks — those fail column
// detection and are skipped. No auth.
//
// Usage: pnpm tsx scripts/ingest-pangaea.ts [limit] [pagesPerQuery]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { normalizeLicense, isCommercialSafe } from "../lib/licenses";
import { parseDelimited, detectColumns, speciesFromText, validSpecies } from "../lib/csv-tracks";
import type { RawPoint } from "../lib/track";

const SEARCH = "https://www.pangaea.de/advanced/search.php";
const QUERIES = [
  "penguin tracking", "seal satellite tracking", "seabird GPS tracking",
  "albatross tracking", "sea turtle satellite telemetry", "Argos telemetry animal",
  "seabird geolocator migration", "whale satellite tracking", "fur seal foraging tracking",
  "petrel tracking", "shark satellite tag", "animal movement GPS telemetry",
];

const ATT_FILE = fileURLToPath(new URL("../pangaea-attempted.json", import.meta.url));
const loadAttempted = (): Set<string> => { try { return new Set(JSON.parse(readFileSync(ATT_FILE, "utf8"))); } catch { return new Set(); } };
const saveAttempted = (s: Set<string>) => { try { writeFileSync(ATT_FILE, JSON.stringify([...s])); } catch { /* ignore */ } };

async function fetchText(url: string, timeout = 60000): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`pangaea ${r.status}`);
  return r.text();
}

// One PANGAEA dataset id (the numeric PANGAEA.NNNNNN).
async function search(query: string, count: number, offset: number): Promise<string[]> {
  const j = JSON.parse(await fetchText(`${SEARCH}?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}`));
  return (j.results ?? [])
    .map((r: any) => (String(r.URI || "").match(/PANGAEA\.(\d+)/) || [])[1])
    .filter(Boolean);
}

interface Parsed { license: string; citation: string; binomial?: string; header: string[]; dataStart: number; lines: string[] }

// Split the metadata header from the tab data table; pull License + citation.
function parseTextfile(txt: string): Parsed | null {
  const lines = txt.split(/\r?\n/);
  const end = lines.findIndex((l) => l.trim() === "*/");
  if (end < 0 || end + 2 >= lines.length) return null;
  let license = "", citation = "", events = "";
  for (const l of lines.slice(0, end)) {
    if (/^License:/i.test(l)) license = l.split("\t").slice(1).join(" ");
    else if (/^Citation:/i.test(l)) citation = l.split("\t").slice(1).join(" ");
    else if (/^Event\(s\):/i.test(l)) events = l.split("\t").slice(1).join(" ");
  }
  const header = (lines[end + 1] || "").split("\t");
  return { license, citation, binomial: speciesFromText(citation, events), header, dataStart: end + 2, lines };
}

// PANGAEA citations name the animal by COMMON name ("emperor penguin"), so after
// trying a binomial we resolve the citation title via GBIF vernacular search,
// restricted to Chordata (key 44) so a non-animal title can't match junk.
const pgSpeciesCache = new Map<string, string | undefined>();
async function resolveSpecies(binomial: string | undefined, citation: string): Promise<string | undefined> {
  const bin = await validSpecies(binomial);
  if (bin) return bin;
  let t = citation.replace(/^.*?\)\s*:/, "")                    // drop "Authors (year):" prefix
    .split(/\b(?:from|near|off|in the|at the|during)\b/i)[0]    // drop trailing place clause
    .replace(/[A-Za-z]*\d[\w-]*/g, " ")                         // drop event ids / years
    .replace(/\b(the|of|and|data|tracking|dive|temperature|range|time|location|locations?|track|gps|argos|satellite|telemetry|foraging|trip|trips|movement|study|for|at|from|adult|juvenile|male|female|breeding)\b/gi, " ")
    .replace(/[^A-Za-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 4) return undefined;
  if (pgSpeciesCache.has(t)) return pgSpeciesCache.get(t);
  // the common name sits at the END after cleaning; try the whole thing, then the
  // last 2/3 words as a tighter query, restricted to Chordata (key 44).
  const words = t.split(" ");
  const tries = [t, words.slice(-3).join(" "), words.slice(-2).join(" ")].filter((s, i, a) => s.length >= 4 && a.indexOf(s) === i);
  let val: string | undefined;
  for (const q of tries) {
    try {
      const j = await (await fetch(`https://api.gbif.org/v1/species/search?q=${encodeURIComponent(q)}&highertaxonKey=44&rank=SPECIES&limit=1`, { signal: AbortSignal.timeout(15000) })).json();
      const r = j.results?.[0];
      if (r && r.species) { val = r.species; break; }
    } catch { /* try next */ }
  }
  pgSpeciesCache.set(t, val);
  return val;
}

async function ingestDataset(id: string): Promise<{ individuals: number; points: number; species?: string } | null> {
  const txt = await fetchText(`https://doi.pangaea.de/10.1594/PANGAEA.${id}?format=textfile`, 90000);
  const p = parseTextfile(txt);
  if (!p) return null;
  const license = normalizeLicense(p.license);
  if (!isCommercialSafe(license)) return null;

  const col = detectColumns(p.header);
  if (col.lat < 0 || col.lon < 0 || col.time < 0) return null; // not a per-fix track table

  const byInd = new Map<string, { sci?: string; points: RawPoint[] }>();
  for (let i = p.dataStart; i < p.lines.length; i++) {
    const line = p.lines[i];
    if (!line) continue;
    const r = line.split("\t");
    const lat = Number(r[col.lat]), lon = Number(r[col.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const indId = (col.id >= 0 && r[col.id]?.trim()) || "ALL";
    let e = byInd.get(indId);
    if (!e) { e = { sci: col.sci >= 0 ? r[col.sci]?.trim() : undefined, points: [] }; byInd.set(indId, e); }
    e.points.push({ ts: r[col.time], lon, lat });
  }
  if (!byInd.size) return null;

  const species = (await validSpecies([...byInd.values()][0]?.sci)) || (await resolveSpecies(p.binomial, p.citation));
  const inds: IndividualInput[] = [...byInd.entries()].map(([iid, v]) => ({
    sourceIndividualId: iid, name: iid, scientificName: species, points: v.points, raw: { pangaea: id },
  }));
  const summary = await ingestTracks({
    id: `pangaea:${id}`, source: "pangaea",
    title: `PANGAEA ${id}`.slice(0, 300), license,
    doi: `10.1594/PANGAEA.${id}`, citation: `PANGAEA dataset 10.1594/PANGAEA.${id}`, publisher: "PANGAEA",
    raw: { pangaea: id } as object,
  }, inds);
  return summary.individualsWritten > 0
    ? { individuals: summary.individualsWritten, points: summary.pointsWritten, species }
    : null;
}

async function main() {
  const limit = Number(process.argv[2] || 400);
  const pages = Number(process.argv[3] || 8);
  const COUNT = 50;
  const { client } = await import("../db/index");
  await client.exec(`ALTER TYPE "source" ADD VALUE IF NOT EXISTS 'pangaea'`);

  const attempted = loadAttempted();
  console.log(`=== PANGAEA harvest (limit ${limit}, ${QUERIES.length} queries × ≤${pages} pages) — ${attempted.size} attempted ===\n`);
  let ingested = 0, gInd = 0, gPts = 0; const species = new Set<string>();
  outer:
  for (const q of QUERIES) {
    console.log(`— query: "${q}"`);
    for (let page = 0; page < pages; page++) {
      if (ingested >= limit) break outer;
      let ids: string[] = [];
      try { ids = await search(q, COUNT, page * COUNT); } catch (e) { console.error(`  page ${page} failed: ${(e as Error).message}`); continue; }
      if (!ids.length) break;
      for (const id of ids) {
        if (ingested >= limit) break outer;
        if (attempted.has(id)) continue;
        attempted.add(id);
        try {
          const r = await ingestDataset(id);
          if (r) {
            ingested++; gInd += r.individuals; gPts += r.points; if (r.species) species.add(r.species);
            console.log(`  ✓ PANGAEA.${id} → +${r.individuals} ind, +${r.points} pts ${r.species ? `[${r.species}]` : ""}`);
          }
        } catch { /* skip */ }
        if (attempted.size % 25 === 0) saveAttempted(attempted);
        await new Promise((res) => setTimeout(res, 250));
      }
    }
  }
  saveAttempted(attempted);
  console.log(`\n✓ PANGAEA run: ${ingested} datasets · +${gInd} individuals · +${gPts} points · ${species.size} species this run`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
