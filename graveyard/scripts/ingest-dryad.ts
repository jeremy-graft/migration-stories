// Dryad ingester — a second paper-supplement corpus, distinct from Zenodo.
// Dryad MANDATES CC0 on every data file, so the whole repository is
// commercial-safe (we still pass each through the license gate). Same fuzzy
// CSV strategy as Zenodo, shared via lib/csv-tracks. Writes to local PGlite.
//
// Usage: pnpm tsx scripts/ingest-dryad.ts [limit] [pagesPerQuery]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { normalizeLicense, isCommercialSafe } from "../lib/licenses";
import {
  parseDelimited, detectDelim, detectColumns, trackiness, speciesFromText, validSpecies, toNum, normalizeTs,
} from "../lib/csv-tracks";
import type { RawPoint } from "../lib/track";

const BASE = "https://datadryad.org/api/v2";
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const QUERIES = [
  "animal tracking telemetry GPS", "bird GPS tracking migration",
  "seabird satellite tracking", "sea turtle satellite telemetry",
  "shark satellite tag tracking", "mammal GPS collar movement",
  "Argos satellite telemetry", "raptor migration tracking",
  "ungulate GPS collar", "marine mammal tracking", "penguin foraging tracking",
  "waterbird waterfowl GPS tracking", "fish acoustic telemetry movement",
];

const ATT_FILE = fileURLToPath(new URL("../dryad-attempted.json", import.meta.url));
const loadAttempted = (): Set<string> => { try { return new Set(JSON.parse(readFileSync(ATT_FILE, "utf8"))); } catch { return new Set(); } };
const saveAttempted = (s: Set<string>) => { try { writeFileSync(ATT_FILE, JSON.stringify([...s])); } catch { /* ignore */ } };

// OAuth client-credentials token (Dryad requires a bearer token for file
// downloads). Cached until shortly before expiry; re-minted on 401.
let token = "", tokenExp = 0;
async function getToken(): Promise<string> {
  if (token && Date.now() < tokenExp) return token;
  const body = new URLSearchParams({
    client_id: process.env.DRYAD_CLIENT_ID || "", client_secret: process.env.DRYAD_CLIENT_SECRET || "",
    grant_type: "client_credentials",
  });
  const r = await fetch("https://datadryad.org/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body, signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`dryad token ${r.status}`);
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + (Number(j.expires_in || 3600) - 60) * 1000;
  return token;
}

// Dryad rate-limits unauthenticated clients to ~30 requests/min. Enforce a
// minimum spacing between ALL Dryad calls and back off on 429 (Retry-After).
const MIN_SPACING_MS = 2200;
let lastCall = 0;
async function dryadGet(url: string, opts: { json?: boolean; timeout?: number; auth?: boolean } = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const wait = MIN_SPACING_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const headers: Record<string, string> = { "User-Agent": "migration-stories/0.1", ...(opts.json ? { Accept: "application/json" } : {}) };
    if (opts.auth) headers.Authorization = `Bearer ${await getToken()}`;
    const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(opts.timeout ?? 40000) });
    if (r.status === 429) {
      if (attempt >= 5) throw new Error("dryad 429 (gave up)");
      const ra = Number(r.headers.get("retry-after")) || 30;
      await new Promise((res) => setTimeout(res, (ra + 1) * 1000));
      continue;
    }
    if (r.status === 401 && opts.auth && attempt < 2) { token = ""; tokenExp = 0; continue; } // re-mint
    if (!r.ok) throw new Error(`dryad ${r.status}`);
    return opts.json ? r.json() : r.text();
  }
}
const fetchJson = (url: string) => dryadGet(url, { json: true });

interface DFile { path: string; size: number; downloadHref?: string }

// Resolve a dataset's latest-version files via the HAL links.
async function datasetFiles(ds: any): Promise<DFile[]> {
  const vHref = ds?._links?.["stash:version"]?.href;
  if (!vHref) return [];
  const filesUrl = `https://datadryad.org${vHref}/files`;
  let data: any;
  try { data = await fetchJson(filesUrl); } catch { return []; }
  const items: any[] = data?._embedded?.["stash:files"] ?? [];
  return items.map((f) => ({
    path: f.path || "",
    size: Number(f.size || 0),
    downloadHref: f?._links?.["stash:download"]?.href || f?._links?.["stash:file-download"]?.href,
  }));
}

async function ingestDataset(ds: any): Promise<{ individuals: number; points: number; species?: string } | null> {
  const license = normalizeLicense("cc0"); // Dryad mandates CC0 on every data file
  if (!isCommercialSafe(license)) return null;

  const files = await datasetFiles(ds);
  const cands = files
    .filter((f) => /\.(csv|tsv|txt)$/i.test(f.path) && f.size <= MAX_FILE_BYTES && f.size > 200 && !!f.downloadHref && !/readme|metadata|license|citation/i.test(f.path))
    .sort((a, b) => (trackiness(b.path) - trackiness(a.path)) || (b.size - a.size));
  if (!cands.length) return null;

  const titleSpecies = speciesFromText(ds?.title, ds?.abstract);
  const doi = (ds?.identifier || "").replace(/^doi:/, "");

  for (const f of cands.slice(0, 3)) {
    try {
      const text: string = await dryadGet(`https://datadryad.org${f.downloadHref}`, { timeout: 90000, auth: true });
      const firstLine = text.slice(0, text.indexOf("\n"));
      const delim = detectDelim(firstLine);
      const rows = parseDelimited(text, delim);
      if (rows.length < 3) continue;
      const col = detectColumns(rows[0]);
      if (col.lat < 0 || col.lon < 0 || col.time < 0) continue;

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
        sourceIndividualId: id, name: id, scientificName: species, points: v.points, raw: { dryad: doi, file: f.path },
      }));
      const summary = await ingestTracks({
        id: `dryad:${doi}`, source: "zenodo", // reuse repo-deposit source bucket
        title: (ds?.title || `Dryad ${doi}`).slice(0, 300), license,
        doi, citation: ds?.title, publisher: "Dryad",
        raw: { dryad: doi, file: f.path } as object,
      }, individuals);
      if (summary.individualsWritten > 0) return { individuals: summary.individualsWritten, points: summary.pointsWritten, species };
    } catch { /* try next file */ }
  }
  return null;
}

async function main() {
  if (!process.env.DRYAD_CLIENT_ID || !process.env.DRYAD_CLIENT_SECRET) {
    console.error("Missing DRYAD_CLIENT_ID / DRYAD_CLIENT_SECRET in .env"); process.exit(1);
  }
  const limit = Number(process.argv[2] || 400);
  const pagesPerQuery = Number(process.argv[3] || 15);
  const attempted = loadAttempted();
  console.log(`=== Dryad harvest (limit ${limit}, ${QUERIES.length} queries × ≤${pagesPerQuery} pages) ===`);
  console.log(`(${attempted.size} datasets already attempted — skipping)\n`);

  let ingested = 0, gInd = 0, gPts = 0; const newSpecies = new Set<string>();
  outer:
  for (const QUERY of QUERIES) {
    console.log(`\n— query: "${QUERY}"`);
    for (let page = 1; page <= pagesPerQuery; page++) {
      if (ingested >= limit) break outer;
      let data: any;
      try { data = await fetchJson(`${BASE}/search?q=${encodeURIComponent(QUERY)}&per_page=100&page=${page}`); }
      catch (e) { console.error(`  page ${page} failed: ${(e as Error).message}`); continue; }
      const items: any[] = data?._embedded?.["stash:datasets"] ?? [];
      if (!items.length) break;
      for (const ds of items) {
        if (ingested >= limit) break outer;
        const id = ds?.identifier || ds?._links?.self?.href;
        if (!id || attempted.has(id)) continue;
        attempted.add(id);
        try {
          const r = await ingestDataset(ds);
          if (r) {
            ingested++; gInd += r.individuals; gPts += r.points; if (r.species) newSpecies.add(r.species);
            console.log(`  ✓ ${(ds?.title || "").slice(0, 46)} → +${r.individuals} ind, +${r.points} pts ${r.species ? `[${r.species}]` : ""}`);
          }
        } catch { /* skip */ }
        if (attempted.size % 25 === 0) saveAttempted(attempted);
        await new Promise((res) => setTimeout(res, 200));
      }
    }
  }
  saveAttempted(attempted);
  console.log(`\n✓ Dryad run: ${ingested} datasets · +${gInd} individuals · +${gPts} points · ${newSpecies.size} species this run`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
