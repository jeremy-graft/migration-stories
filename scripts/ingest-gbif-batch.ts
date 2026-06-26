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

async function requestDownload(body: object, auth: string): Promise<string> {
  const res = await fetch(`${GBIF}/occurrence/download/request`, {
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
    const meta = await (await fetch(`${GBIF}/occurrence/download/${key}`)).json();
    process.stdout.write(`  status: ${meta.status}${meta.totalRecords ? ` (${meta.totalRecords} records)` : ""}\n`);
    if (meta.status === "SUCCEEDED") return { doi: meta.doi, url: meta.downloadLink, total: meta.totalRecords ?? 0 };
    if (["KILLED", "FAILED", "CANCELLED"].includes(meta.status)) throw new Error(`download ${meta.status}`);
  }
  throw new Error("download did not succeed within the polling window");
}

/** Per-dataset, per-individual accumulator built by streaming occurrence.txt. */
interface DatasetAccum { license: string; individuals: Map<string, { sci?: string; points: RawPoint[] }> }

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
    const orgId = col.org >= 0 ? f[col.org] : "";
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

async function main() {
  const arg = process.argv[2] || "inbo";
  const { opts, label } = predicateForArg(arg);
  const predicate = buildDownloadPredicate(opts);

  const user = process.env.GBIF_USER, pass = process.env.GBIF_PASS, email = process.env.GBIF_EMAIL;
  if (!user || !pass || !email) {
    console.log(`GBIF credentials absent — skipping live download (see RUN_WHEN_READY.md).`);
    console.log(`Target: ${label}\nPredicate that WOULD be submitted:\n`, JSON.stringify(predicate, null, 2));
    process.exit(0);
  }

  console.log(`\n=== GBIF batch ingest: ${label} ===`);
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  const body = buildDownloadRequest({ creator: user, email, predicate, format: "DWCA" });

  console.log("Requesting download…");
  const key = await requestDownload(body, auth);
  console.log("downloadKey:", key);
  const { doi, url, total } = await pollDownload(key);
  console.log(`✓ Ready. ${total} records. Download DOI (cite this): ${doi}`);

  // Download the archive to a temp file, then stream-parse it.
  const dir = mkdtempSync(join(tmpdir(), "gbif-"));
  const zipPath = join(dir, "dwca.zip");
  try {
    console.log("Downloading archive…");
    const resp = await fetch(url, { headers: { Authorization: auth } });
    if (!resp.ok || !resp.body) throw new Error(`archive download failed: ${resp.status}`);
    await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(zipPath));

    console.log("Parsing archive…");
    const byDataset = await parseArchive(zipPath);

    // Ingest each dataset (fetch metadata for attribution).
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
      console.log(`  ${meta?.title?.slice(0, 50) ?? datasetKey}: +${summary.individualsWritten} individuals, +${summary.pointsWritten} points (${summary.skipped} skipped)`);
      totalInd += summary.individualsWritten; totalPts += summary.pointsWritten;
    }
    console.log(`\n✓ Ingested ${totalInd} individuals · ${totalPts} track points across ${byDataset.size} dataset(s).`);
    console.log(`  download DOI: ${doi}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
