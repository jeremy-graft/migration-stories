// PHASE 4 — Movebank Data Repository direct ingestion (CC0, mostly no auth).
// Many fully-public studies read without credentials; the license-acceptance
// handshake is in lib/sources/movebank.ts. Respect one concurrent request per IP.
//
// Usage: pnpm ingest-movebank-repo <studyId> [scientificName] [commonName]
//
// IMPORTANT: only ingest studies you've confirmed are CC0 / CC BY. Movebank
// direct-read does not always surface a machine-readable license, so we require
// the operator to assert it; default LICENSE here is CC0 for repository studies,
// but verify before trusting it for commercial use.
import "dotenv/config";
import { movebankRead, eventReadParams, parseMovebankCsv } from "../lib/sources/movebank";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import type { RawPoint } from "../lib/track";

async function main() {
  const studyId = process.argv[2];
  if (!studyId) {
    console.error("Usage: pnpm ingest-movebank-repo <studyId> [scientificName] [commonName]");
    process.exit(1);
  }
  const scientificName = process.argv[3];
  const commonName = process.argv[4];

  console.log(`Reading Movebank study ${studyId} (with license handshake if needed)…`);
  const csv = await movebankRead(eventReadParams(studyId));

  if (/error|not.*permission|no.*access/i.test(csv.slice(0, 300)) && !/timestamp/i.test(csv.slice(0, 300))) {
    console.error("Movebank did not return event data. This study likely needs credentials or terms acceptance.");
    console.error("First 300 chars:\n", csv.slice(0, 300));
    console.error("\nSee RUN_WHEN_READY.md to set MOVEBANK_USER / MOVEBANK_PASS.");
    process.exit(1);
  }

  const events = parseMovebankCsv(csv);
  console.log(`Parsed ${events.length} events.`);

  // Group events into per-individual point lists.
  const byInd = new Map<string, RawPoint[]>();
  for (const e of events) {
    if (!e.individual) continue;
    const arr = byInd.get(e.individual) ?? [];
    arr.push({ ts: e.ts, lon: e.lon, lat: e.lat });
    byInd.set(e.individual, arr);
  }

  const individuals: IndividualInput[] = [...byInd.entries()].map(([id, points]) => ({
    sourceIndividualId: id,
    name: id,
    scientificName,
    commonName,
    points,
    raw: { studyId },
  }));

  const summary = await ingestTracks(
    {
      id: `movebank_repo:${studyId}`,
      source: "movebank_repo",
      title: `Movebank study ${studyId}`,
      license: "CC0_1_0", // asserted for repository studies — verify per study
      citation: `Movebank Data Repository, study ${studyId}`,
      publisher: "Movebank Data Repository",
      raw: { studyId },
    },
    individuals,
  );

  console.log("✓ Ingested:", summary);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
