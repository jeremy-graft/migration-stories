// PHASE 3 — GBIF license-filtered batch ingestion via the async download API.
// Pulls FULL tracks (incl. richly-tracked individuals the search API can't page)
// as a Darwin Core Archive, then normalizes → writes via the shared ingest writer.
//
// Needs a GBIF account: GBIF_USER / GBIF_PASS / GBIF_EMAIL. Without them the
// script prints the predicate it WOULD submit and exits (the predicate builder
// and CSV parser are unit-tested in tests/gbif-predicate.test.ts).
//
// Usage:
//   pnpm ingest-gbif-batch <datasetKey>   # one dataset (recommended first run)
//   pnpm ingest-gbif-batch inbo           # all INBO datasets (publishingOrg)
//   pnpm ingest-gbif-batch 212            # a taxonKey (e.g. 212 = Aves)
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import readline from "node:readline";
import unzipper from "unzipper";
import { buildDownloadPredicate, buildDownloadRequest, type DownloadPredicateOpts } from "../lib/sources/gbif-download";
import { gbifDataset } from "../lib/sources/gbif";
import { normalizeLicense, isCommercialSafe } from "../lib/licenses";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import type { RawPoint } from "../lib/track";

const GBIF = "https://api.gbif.org/v1";
const INBO_ORG = "1cd669d0-80ea-11de-a9d0-f1765f95f18b";

function predicateForArg(arg: string): { opts: DownloadPredicateOpts; label: string } {
  if (arg === "inbo") return { opts: { publishingOrg: INBO_ORG }, label: "INBO (all datasets)" };
  if (/^[0-9a-f-]{36}$/i.test(arg)) return { opts: { datasetKeys: [arg] }, label: `dataset ${arg}` };
  return { opts: { taxonKey: arg }, label: `taxonKey ${arg}` };
}

// Retry GBIF API calls through transient connect timeouts / 5xx (undici has a
// 10s connect timeout and no retry by default; the long batches hit blips).
async function fetchRetry(url: string, init: RequestInit, tries = 5): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.min(2000 * (i + 1), 8000)));
    }
  }
  throw new Error(`unreachable: ${url}`);
}

async function requestDownload(body: object, auth: string): Promise<string> {
  const res = await fetchRetry(`${GBIF}/occurrence/download/request`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`download request failed: ${res.status} ${await res.text()}`);
  return (await res.text()).trim();
}

async function pollDownload(key: string): Promise<{ doi?: string; url: string; total: number }> {
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const meta = await (await fetchRetry(`${GBIF}/occurrence/download/${key}`, {})).json();
    process.stdout.write(`  status: ${meta.status}${meta.totalRecords ? ` (${meta.totalRecords} records)` : ""}\n`);
    if (meta.status === "SUCCEEDED") return { doi: meta.doi, url: meta.downloadLink, total: meta.totalRecords ?? 0 };
    if (["KILLED", "FAILED", "CANCELLED"].includes(meta.status)) throw new Error(`download ${meta.status}`);
  }
  throw new Error("download did not succeed within the polling window");
}

/** Download the (possibly large) DWCA zip to a file, retrying dropped connections. */
async function downloadArchive(url: string, auth: string, zipPath: string, tries = 3): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(url, { headers: { Authorization: auth } });
      if (!resp.ok || !resp.body) throw new Error(`archive download failed: ${resp.status}`);
      await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(zipPath));
      return;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
}

/** Per-dataset, per-individual accumulator built by streaming occurrence.txt. */
interface DatasetAccum { license: string; individuals: Map<string, { sci?: string; points: RawPoint[] }> }

/**
 * Resolve a tracked individual's id across fragmented source conventions:
 * organismID (INBO/Movebank) → organismName (e.g. bobcats) → individualID →
 * the pre-"deployment" prefix of occurrenceID (e.g. RAATD seals, gannets:
 * "13440_88727:deployment:…", "90823974_deployment_4"). Returns "" if none.
 */
function pickIndividual(f: string[], col: Record<string, number>): string {
  const direct =
    (col.org >= 0 && f[col.org]) ||
    (col.orgName >= 0 && f[col.orgName]) ||
    (col.indId >= 0 && f[col.indId]);
  if (direct) return direct;
  if (col.occ >= 0 && f[col.occ]) {
    const m = f[col.occ].match(/^(.+?)[_:]deployment[_:]/i);
    if (m) return m[1];
  }
  return "";
}

async function parseArchive(zipPath: string): Promise<Map<string, DatasetAccum>> {
  const directory = await unzipper.Open.file(zipPath);
  const entry = directory.files.find((f) => f.path === "occurrence.txt");
  if (!entry) throw new Error("occurrence.txt not found in archive");

  const rl = readline.createInterface({ input: entry.stream(), crlfDelay: Infinity });
  const byDataset = new Map<string, DatasetAccum>();
  let header: string[] | null = null;
  let col: Record<string, number> = {};
  let rows = 0, kept = 0;

  for await (const line of rl) {
    if (!header) {
      header = line.split("\t");
      const idx = (n: string) => header!.indexOf(n);
      col = {
        dataset: idx("datasetKey"), org: idx("organismID"),
        orgName: idx("organismName"), indId: idx("individualID"), occ: idx("occurrenceID"),
        lat: idx("decimalLatitude"), lon: idx("decimalLongitude"),
        date: idx("eventDate"), lic: idx("license"),
        sci: idx("species") >= 0 ? idx("species") : idx("scientificName"),
      };
      continue;
    }
    rows++;
    const f = line.split("\t");
    const license = normalizeLicense(col.lic >= 0 ? f[col.lic] : undefined);
    if (!isCommercialSafe(license)) continue;                 // per-row license gate
    const orgId = pickIndividual(f, col);
    if (!orgId) continue;                                     // need an individual id
    const datasetKey = col.dataset >= 0 ? f[col.dataset] : "unknown";

    let acc = byDataset.get(datasetKey);
    if (!acc) { acc = { license: col.lic >= 0 ? f[col.lic] : "", individuals: new Map() }; byDataset.set(datasetKey, acc); }
    let ind = acc.individuals.get(orgId);
    if (!ind) { ind = { sci: col.sci >= 0 ? f[col.sci] : undefined, points: [] }; acc.individuals.set(orgId, ind); }
    ind.points.push({ ts: col.date >= 0 ? f[col.date] : undefined, lon: Number(f[col.lon]), lat: Number(f[col.lat]) });
    kept++;
  }
  process.stdout.write(`  parsed ${rows} rows, kept ${kept} commercial-safe points across ${byDataset.size} dataset(s)\n`);
  return byDataset;
}

/** Run one download (a single predicate) end-to-end: download → parse → ingest. */
async function ingestOne(opts: DownloadPredicateOpts, label: string, auth: string, email: string, user: string) {
  const predicate = buildDownloadPredicate(opts);
  const body = buildDownloadRequest({ creator: user, email, predicate, format: "DWCA" });
  console.log(`\n— ${label}: requesting download…`);
  const key = await requestDownload(body, auth);
  const { doi, url, total } = await pollDownload(key);
  console.log(`  ready: ${total} records · DOI ${doi}`);

  const dir = mkdtempSync(join(tmpdir(), "gbif-"));
  const zipPath = join(dir, "dwca.zip");
  try {
    await downloadArchive(url, auth, zipPath);
    const byDataset = await parseArchive(zipPath);

    let totalInd = 0, totalPts = 0;
    for (const [datasetKey, acc] of byDataset) {
      const meta = await gbifDataset(datasetKey).catch(() => null);
      const license = normalizeLicense(meta?.license ?? acc.license);
      const individuals: IndividualInput[] = [...acc.individuals.entries()].map(([id, v]) => ({
        sourceIndividualId: id, name: id, scientificName: v.sci, points: v.points, raw: { datasetKey },
      }));
      const summary = await ingestTracks(
        {
          id: `gbif:${datasetKey}`, source: "gbif",
          title: meta?.title ?? datasetKey, doi: meta?.doi, license,
          citation: meta?.citation, publisher: meta?.publisher,
          raw: { downloadKey: key, downloadDoi: doi } as object,
        },
        individuals,
      );
      console.log(`  ✓ ${meta?.title?.slice(0, 50) ?? datasetKey}: +${summary.individualsWritten} ind, +${summary.pointsWritten} pts (${summary.skipped} skipped)`);
      totalInd += summary.individualsWritten; totalPts += summary.pointsWritten;
    }
    return { individuals: totalInd, points: totalPts, doi };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** INBO telemetry datasetKeys, read from our own catalog (the migration core). */
async function inboDatasetKeys(): Promise<string[]> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`select id from datasets where publisher ilike ${"%INBO%"} order by record_count desc nulls last`;
  return (rows as Array<{ id: string }>).map((r) => r.id.replace(/^gbif:/, ""));
}

/**
 * The next tranche of migration datasets to ingest: GPS bird/mammal/reptile
 * datasets from the catalog that have NO track points yet, richest first.
 */
async function migrationDatasets(limit: number): Promise<Array<{ key: string; records: number }>> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  // Exclude survey/observation/databank/eDNA datasets — they aren't GPS tracks
  // even when a taxon class looks bird/mammal. Keeps tranches focused on journeys.
  const rows = await sql`
    select id, coalesce(record_count, 0)::int records from datasets
    where telemetry_type in ('gps/argos', 'gps/other')
      and taxon_group in ('bird', 'mammal', 'reptile')
      and title !~* 'survey|databank|notebook|edna|monitoring|camera|soundscape|general observ|acoustic|detection|expedition|checklist|atlas|ringing|census'
      and id not in (select distinct dataset_id from individuals)
      and ingest_attempted_at is null
    order by record_count desc nulls last
    limit ${limit}`;
  return (rows as Array<{ id: string; records: number }>).map((r) => ({ key: r.id.replace(/^gbif:/, ""), records: r.records }));
}

/** Group datasets into download batches bounded by cumulative records + count. */
function chunkByRecords<T extends { records: number }>(items: T[], maxRecords: number, maxCount: number): T[][] {
  const groups: T[][] = [];
  let cur: T[] = [], sum = 0;
  for (const it of items) {
    if (cur.length && (sum + it.records > maxRecords || cur.length >= maxCount)) { groups.push(cur); cur = []; sum = 0; }
    cur.push(it); sum += it.records;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/** Mark a dataset as download-attempted so empty ones aren't re-fetched forever. */
async function markAttempted(key: string) {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  await sql`update datasets set ingest_attempted_at = now() where id = ${`gbif:${key}`}`;
}

/** Ingest a list of datasetKeys sequentially, tolerating per-dataset failures. */
async function runBatch(keys: string[], label: string, auth: string, email: string, user: string) {
  console.log(`\n=== GBIF batch ingest: ${label} — ${keys.length} datasets ===`);
  let gInd = 0, gPts = 0, n = 0;
  for (const k of keys) {
    n++;
    try {
      const r = await ingestOne({ datasetKeys: [k] }, `[${n}/${keys.length}] ${k}`, auth, email, user);
      gInd += r.individuals; gPts += r.points;
      await markAttempted(k); // succeeded (even if 0 tracks) → don't re-fetch in future tranches
    } catch (e) {
      console.error(`  ✗ ${k} failed: ${(e as Error).message}`); // transient → leave unmarked for retry
    }
    console.log(`  …running total: ${gInd} individuals · ${gPts} points`);
  }
  console.log(`\n✓ ${label} complete: ${gInd} individuals · ${gPts} track points across ${keys.length} datasets.`);
}

async function main() {
  const arg = process.argv[2] || "inbo";
  const user = process.env.GBIF_USER, pass = process.env.GBIF_PASS, email = process.env.GBIF_EMAIL;

  if (!user || !pass || !email) {
    const { opts, label } = predicateForArg(arg);
    console.log(`GBIF credentials absent — skipping live download (see RUN_WHEN_READY.md).`);
    console.log(`Target: ${label}\nPredicate that WOULD be submitted:\n`, JSON.stringify(buildDownloadPredicate(opts), null, 2));
    process.exit(0);
  }
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  if (arg === "inbo") {
    await runBatch(await inboDatasetKeys(), "INBO", auth, email, user);
  } else if (arg === "migration") {
    const limit = Number(process.argv[3] || 60);
    const items = await migrationDatasets(limit);
    const groups = chunkByRecords(items, 1_800_000, 15); // ≤1.8M recs / ≤15 datasets per GBIF job
    console.log(`\n=== Batched migration ingest: ${items.length} datasets in ${groups.length} download job(s) ===`);
    let gInd = 0, gPts = 0;
    for (let i = 0; i < groups.length; i++) {
      const keys = groups[i].map((g) => g.key);
      const recs = groups[i].reduce((s, g) => s + g.records, 0);
      try {
        const r = await ingestOne({ datasetKeys: keys }, `batch ${i + 1}/${groups.length} (${keys.length} datasets, ~${recs.toLocaleString()} recs)`, auth, email, user);
        gInd += r.individuals; gPts += r.points;
        for (const k of keys) await markAttempted(k);
      } catch (e) {
        console.error(`  ✗ batch ${i + 1} failed: ${(e as Error).message}`);
      }
      console.log(`  …running total: ${gInd} individuals · ${gPts} points`);
    }
    console.log(`\n✓ Batched migration complete: ${gInd} individuals · ${gPts} points across ${items.length} datasets.`);
  } else {
    const { opts, label } = predicateForArg(arg);
    console.log(`\n=== GBIF batch ingest: ${label} ===`);
    const r = await ingestOne(opts, label, auth, email, user);
    console.log(`\n✓ Ingested ${r.individuals} individuals · ${r.points} track points.\n  download DOI: ${r.doi}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
