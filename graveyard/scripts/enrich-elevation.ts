// Environmental enrichment #1 — terrain. Annotate every track point with ETOPO1
// relief (metres; negative = ocean depth). We pull ONE coarse (~0.25°) global
// grid from a reachable ERDDAP, cache it, and sample locally — no per-point API
// calls. Resumable: only fills track_points.elevation where still NULL, updating
// in batches, so a flaky connection or a session break never loses progress.
//
// Usage: pnpm tsx scripts/enrich-elevation.ts
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql, client } from "../db/index";

const STEP = 0.25, N_LAT = 721, N_LON = 1441;              // -90..90, -180..180 @ 0.25°
const STRIDE = 15;                                          // 15 × (1/60)° ≈ 0.25°
const GRID_URL = `https://pae-paha.pacioos.hawaii.edu/erddap/griddap/etopo1_bedrock.csv?z[(-90.0):${STRIDE}:(90.0)][(-180.0):${STRIDE}:(180.0)]`;
const CACHE = fileURLToPath(new URL("../etopo-0.25deg.bin", import.meta.url));

const idx = (lat: number, lon: number) => {
  const li = Math.min(N_LAT - 1, Math.max(0, Math.round((lat + 90) / STEP)));
  const oi = Math.min(N_LON - 1, Math.max(0, Math.round((lon + 180) / STEP)));
  return li * N_LON + oi;
};

async function loadGrid(): Promise<Float32Array> {
  if (existsSync(CACHE)) {
    const buf = readFileSync(CACHE);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  }
  console.log("Fetching global relief grid (one-time)…");
  const r = await fetch(GRID_URL, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`grid fetch ${r.status}`);
  const text = await r.text();
  const grid = new Float32Array(N_LAT * N_LON).fill(NaN);
  const lines = text.split("\n");
  for (let i = 2; i < lines.length; i++) {            // skip header + units rows
    const c = lines[i].split(",");
    if (c.length < 3) continue;
    const lat = Number(c[0]), lon = Number(c[1]), z = Number(c[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    grid[idx(lat, lon)] = Number.isFinite(z) ? z : NaN;
  }
  writeFileSync(CACHE, Buffer.from(grid.buffer));
  console.log(`  cached ${N_LAT * N_LON} cells → etopo-0.25deg.bin`);
  return grid;
}

async function main() {
  await client.exec(`ALTER TABLE track_points ADD COLUMN IF NOT EXISTS elevation real`);
  const grid = await loadGrid();

  const [{ todo }] = (await sql`select count(*)::int todo from track_points where elevation is null`) as any[];
  console.log(`Points to enrich: ${Number(todo).toLocaleString()}\n`);

  let done = 0;
  const BATCH = 20000, CHUNK = 2000;
  while (true) {
    const rows = (await sql`select id, lon, lat from track_points where elevation is null limit ${BATCH}`) as any[];
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const vals: string[] = [];
      const params: any[] = [];
      let p = 1;
      for (const r of slice) {
        const z = grid[idx(r.lat, r.lon)];
        vals.push(`($${p++}::bigint, $${p++}::real)`);
        params.push(r.id, Number.isFinite(z) ? z : null);
      }
      // NULL would re-select forever; use a sentinel? Instead set NaN-cells to a
      // real value: 0 is a legit elevation, so use -99999 marker → treat as "sea level unknown".
      const q = `update track_points as t set elevation = coalesce(v.e, -99999)
                 from (values ${vals.join(",")}) as v(id, e) where t.id = v.id`;
      await client.query(q, params);
    }
    done += rows.length;
    process.stdout.write(`\r  enriched ${done.toLocaleString()} / ${Number(todo).toLocaleString()}`);
  }
  console.log(`\n✓ Elevation enrichment complete.`);
  const [{ ocean, land, unk }] = (await sql`
    select count(*) filter (where elevation < 0 and elevation > -99999)::int ocean,
           count(*) filter (where elevation >= 0)::int land,
           count(*) filter (where elevation = -99999)::int unk
    from track_points`) as any[];
  console.log(`  over ocean: ${Number(ocean).toLocaleString()} · over land: ${Number(land).toLocaleString()} · no-data: ${Number(unk).toLocaleString()}`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
