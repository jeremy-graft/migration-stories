// Corpus-wide timestamp repair. Some deposits carried corrupt dates (years like
// 0099 / 2048) that survived parsing; they scramble a track's point order and
// inflate its distance, and they poisoned the stored per-individual metrics
// (distance_km / track_start / track_end / point_count / bbox), which were
// computed WITH the bad points. This removes out-of-range points and recomputes
// the metrics of every affected individual from what remains.
//
// Usage: pnpm tsx scripts/fix-timestamps.ts        # survey (dry-run)
//        pnpm tsx scripts/fix-timestamps.ts --fix
import "dotenv/config";
import * as turf from "@turf/turf";
import { eq } from "drizzle-orm";
import { db, sql, client } from "../db/index";
import { individuals, trackPoints } from "../db/schema";

// Satellite/GPS telemetry is modern; anything outside this is corrupt.
const LO = "1970-01-01", HI = "2027-01-01";

async function main() {
  const fix = process.argv.includes("--fix");

  const [{ bad, inds }] = (await sql`
    select count(*)::int bad, count(distinct individual_id)::int inds
    from track_points where ts < ${LO} or ts >= ${HI}`) as any[];
  console.log(`Corrupt-timestamp points: ${Number(bad).toLocaleString()} across ${inds} individuals.`);

  const hist = (await sql`
    select extract(year from ts)::int y, count(*)::int n
    from track_points where ts < ${LO} or ts >= ${HI}
    group by extract(year from ts) order by n desc limit 12`) as any[];
  if (hist.length) { console.log("Bad-year distribution:"); for (const h of hist) console.log(`  year ${String(h.y).padStart(6)}: ${Number(h.n).toLocaleString()} pts`); }

  if (!Number(bad)) { console.log("Nothing to fix."); await client.close(); process.exit(0); }
  if (!fix) { console.log("\n(dry-run) re-run with --fix to delete these points and recompute affected individuals."); await client.close(); process.exit(0); }

  const affected = (await sql`select distinct individual_id id from track_points where ts < ${LO} or ts >= ${HI}`) as any[];
  console.log(`\nDeleting corrupt points and recomputing ${affected.length} individuals…`);
  await sql`delete from track_points where ts < ${LO} or ts >= ${HI}`;

  let recomputed = 0, emptied = 0;
  for (const { id } of affected) {
    const pts = (await sql`select ts, lon, lat from track_points where individual_id = ${id} and visible order by ts`) as any[];
    if (pts.length < 2) {
      emptied++;
      await db.update(individuals).set({
        pointCount: pts.length, distanceKm: 0,
        trackStart: pts[0]?.ts ?? null, trackEnd: pts[0]?.ts ?? null,
      }).where(eq(individuals.id, id));
      continue;
    }
    const coords = pts.map((p) => [p.lon, p.lat] as [number, number]);
    const line = turf.lineString(coords);
    const bb = turf.bbox(line) as [number, number, number, number];
    await db.update(individuals).set({
      pointCount: pts.length,
      distanceKm: turf.length(line, { units: "kilometers" }),
      trackStart: pts[0].ts, trackEnd: pts[pts.length - 1].ts, bbox: bb,
    }).where(eq(individuals.id, id));
    recomputed++;
  }
  const [{ p }] = (await sql`select count(*)::int p from track_points`) as any[];
  console.log(`✓ Removed ${Number(bad).toLocaleString()} points. Recomputed ${recomputed} individuals (${emptied} left <2 pts). Track points now: ${Number(p).toLocaleString()}.`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
