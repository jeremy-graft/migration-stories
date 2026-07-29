// Rescue the intact heap to durable CSV files, BEFORE any more risky ops can
// touch it. Uses PGlite COPY (sequential scan) with index scans disabled, so the
// corrupt indexes are never read. Output goes to rescue/ — a portable, engine-
// agnostic copy we can reload anywhere (fresh PGlite, DuckDB, whatever).
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { client } from "../db/index";

const DIR = fileURLToPath(new URL("../rescue", import.meta.url));

async function dump(name: string, selectSql: string) {
  const t0 = Date.now();
  process.stdout.write(`  ${name}… `);
  const res: any = await client.query(`COPY (${selectSql}) TO '/dev/blob' WITH (FORMAT csv, HEADER)`);
  const buf = Buffer.from(await res.blob.arrayBuffer());
  writeFileSync(`${DIR}/${name}.csv`, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)}MB in ${((Date.now() - t0) / 1000).toFixed(0)}s ✓`);
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  await client.query(`SET enable_indexscan = off`);
  await client.query(`SET enable_bitmapscan = off`);
  console.log("Rescuing corpus to rescue/ (sequential scans, corrupt indexes bypassed):");
  await dump("datasets", "select * from datasets");
  await dump("individuals", "select * from individuals");
  await dump("species_shifts", "select * from species_shifts");
  await dump("stories", "select * from stories");
  await dump("track_points", "select id, individual_id, ts, lon, lat, visible, elevation from track_points");
  console.log("\n✓ Rescue complete — data is now safe in portable CSV files.");
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error("RESCUE FAILED:", e.message); process.exit(1); });
