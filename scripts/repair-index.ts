// Repair the corrupted track_points index (damaged by hard-killing PGlite
// mid-write). Strategy: confirm the HEAP is readable (seq-scan counts), then DROP
// the corrupt index and rebuild it from the heap. If the rebuild scans all rows
// cleanly, the actual data is intact and only the index was damaged.
import "dotenv/config";
import { sql, client } from "../db/index";

async function main() {
  console.log("1) Heap readability (sequential scans — bypass the index):");
  for (const t of ["track_points", "individuals", "datasets", "species_shifts"]) {
    try {
      const [{ n }] = (await client.query(`select count(*)::int n from ${t}`)).rows as any[];
      console.log(`   ${t.padEnd(16)} ${Number(n).toLocaleString()} rows ✓`);
    } catch (e) { console.log(`   ${t.padEnd(16)} ✗ ${(e as Error).message}`); }
  }

  console.log("\n2) Dropping corrupt index…");
  await client.exec(`DROP INDEX IF EXISTS track_points_individual_ts_idx`);
  console.log("   dropped.");

  console.log("3) Rebuilding index from heap (scans all 5.8M rows — fails loudly if any data page is damaged)…");
  const t0 = Date.now();
  await client.exec(`CREATE INDEX track_points_individual_ts_idx ON track_points (individual_id, ts)`);
  console.log(`   ✓ rebuilt cleanly in ${((Date.now() - t0) / 1000).toFixed(0)}s — heap is intact, only the index was corrupt.`);

  console.log("\n4) Verify an index-using query works:");
  const [{ id }] = (await sql`select individual_id id from track_points limit 1`) as any[];
  const rows = (await sql`select ts from track_points where individual_id = ${id} order by ts limit 3`) as any[];
  console.log(`   index scan returned ${rows.length} rows ✓`);

  const [{ enr, tot }] = (await sql`select count(*) filter (where elevation is not null)::int enr, count(*)::int tot from track_points`) as any[];
  console.log(`\nElevation enrichment so far: ${Number(enr).toLocaleString()} / ${Number(tot).toLocaleString()} points.`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error("REPAIR FAILED:", e.message); process.exit(1); });
