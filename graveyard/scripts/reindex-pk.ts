// Rebuild the corrupted indexes from the (intact) heap. Hypothesis: the earlier
// hang was tiny maintenance_work_mem forcing a pathological external sort in
// WASM. Bump it so the sort fits in memory, then REINDEX. Times each step so we
// learn whether PGlite is viable at this scale or we need a different local store.
import "dotenv/config";
import { client } from "../db/index";

async function step(label: string, q: string) {
  const t0 = Date.now();
  process.stdout.write(`${label}… `);
  await client.query(q);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ✓`);
}

async function main() {
  await client.query(`SET maintenance_work_mem = '160MB'`);
  await client.query(`SET work_mem = '96MB'`);
  console.log("sort memory bumped. rebuilding PK index from heap…\n");
  await step("REINDEX track_points_pkey", `REINDEX INDEX track_points_pkey`);
  // quick proof the PK works now
  const r = await client.query(`select id from track_points where id > 12000000 order by id limit 1`);
  console.log(`  PK index scan works: ${(r.rows as any[]).length} row ✓`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error("REINDEX failed:", e.message); process.exit(1); });
