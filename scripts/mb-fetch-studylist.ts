// Fetch the full Movebank study list once and cache it to movebank-studies.csv
// (gitignored). Re-fetch when you want fresh study metadata. Uses the same
// license-handshake reader as event reads. One polite request.
//
// Usage: pnpm tsx scripts/mb-fetch-studylist.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { movebankRead } from "../lib/sources/movebank";

const OUT = fileURLToPath(new URL("../movebank-studies.csv", import.meta.url));

async function main() {
  const csv = await movebankRead({
    entity_type: "study",
    attributes: "id,name,license_type,taxon_ids,sensor_type_ids,number_of_deployed_locations,number_of_individuals",
  });
  const lines = csv.split(/\r?\n/).filter((l) => l.length);
  writeFileSync(OUT, csv);
  console.log(`✓ Saved ${lines.length - 1} studies → ${OUT}`);

  // quick license tally so we can see the NC pool we're about to unlock
  const header = lines[0].split(",");
  const li = header.indexOf("license_type");
  const tally = new Map<string, number>();
  for (const l of lines.slice(1)) { const k = l.split(",")[li] || "(none)"; tally.set(k, (tally.get(k) ?? 0) + 1); }
  console.log("license_type tally:");
  for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${n}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
