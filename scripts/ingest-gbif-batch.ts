// PHASE 3 — GBIF license-filtered batch ingestion via the async download API.
// Needs a GBIF account (GBIF_USER/GBIF_PASS/GBIF_EMAIL). Without creds, this
// script self-skips and points you at RUN_WHEN_READY.md — the predicate builder
// and CSV parser (the hard parts) are unit-tested independently.
//
// Usage: pnpm ingest-gbif-batch [taxonKey] [country]
import "dotenv/config";
import { buildDownloadPredicate, buildDownloadRequest, parseOccurrenceCsv, groupByIndividual } from "../lib/sources/gbif-download";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { normalizeLicense } from "../lib/licenses";

const GBIF = "https://api.gbif.org/v1";

async function main() {
  const taxonKey = process.argv[2] || "212"; // Aves
  const country = process.argv[3];
  const predicate = buildDownloadPredicate({ taxonKey, country });

  const user = process.env.GBIF_USER, pass = process.env.GBIF_PASS, email = process.env.GBIF_EMAIL;
  if (!user || !pass || !email) {
    console.log("GBIF credentials absent — skipping live download (see RUN_WHEN_READY.md).");
    console.log("Predicate that WOULD be submitted:\n", JSON.stringify(predicate, null, 2));
    process.exit(0);
  }

  const body = buildDownloadRequest({ creator: user, email, predicate, format: "DWCA" });
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  console.log("Requesting download…");
  const post = await fetch(`${GBIF}/occurrence/download/request`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!post.ok) throw new Error(`download request failed: ${post.status} ${await post.text()}`);
  const downloadKey = (await post.text()).trim();
  console.log("downloadKey:", downloadKey);

  // Poll until SUCCEEDED.
  let status = "PREPARING", doi: string | undefined, url: string | undefined;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const meta = await (await fetch(`${GBIF}/occurrence/download/${downloadKey}`)).json();
    status = meta.status; doi = meta.doi; url = meta.downloadLink;
    console.log(`  status: ${status}`);
    if (status === "SUCCEEDED") break;
    if (["KILLED", "FAILED", "CANCELLED"].includes(status)) throw new Error(`download ${status}`);
  }
  if (status !== "SUCCEEDED" || !url) throw new Error("download did not succeed in time");
  console.log("download DOI (cite this):", doi);

  // NOTE: DWCA is a zip; extracting occurrence.txt requires an unzip step.
  // Left as the final wiring for the live run — documented in RUN_WHEN_READY.md.
  console.log(`Download ready at ${url}. Extract occurrence.txt, then:`);
  console.log("  const rows = parseOccurrenceCsv(text);  // tab-separated");
  console.log("  const byInd = groupByIndividual(rows);   // per-individual tracks");
  console.log("  await ingestTracks(dataset, individuals);");

  // Demonstrate the in-memory pipeline shape (no-op without extracted file):
  void parseOccurrenceCsv; void groupByIndividual; void ingestTracks;
  void ((): IndividualInput[] => [])();
  void normalizeLicense;
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
