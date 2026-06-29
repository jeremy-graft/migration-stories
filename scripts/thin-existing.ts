// Thin already-ingested tracks to story resolution (≤1 fix / 12h ≈ 1–2/day) and
// recompute each individual's stats. Half-hourly GPS is overkill for telling a
// migration story; this reclaims ~10× the rows so we can afford far more species.
//
// Reversible: the raw points can always be re-pulled with `pnpm ingest-gbif-batch`.
//
// Usage: pnpm thin-existing
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, sql } from "../db/index";
import { individuals, stories } from "../db/schema";
import { reconstructTrack, type RawPoint } from "../lib/track";

const BUCKET = 43200; // 12h in seconds — keep the first fix in each 12h window

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1];
  return out;
}

async function main() {
  const before = Number((await sql`select count(*)::bigint n from track_points` as any)[0].n);
  const inds = (await sql`select id from individuals order by point_count desc nulls last` as any) as Array<{ id: string }>;
  console.log(`Thinning ${inds.length} individuals to ≤1 fix / 12h…  (${before.toLocaleString()} points now)\n`);

  let done = 0;
  for (const { id } of inds) {
    // Delete all but the first fix in each 12h bucket, within this individual.
    await sql`
      delete from track_points t using (
        select id, row_number() over (
          partition by floor(extract(epoch from ts) / ${BUCKET}) order by ts
        ) rn
        from track_points where individual_id = ${id}
      ) k
      where t.id = k.id and k.rn > 1`;

    // Recompute stats from what remains.
    const pts = (await sql`select ts, lat, lon, visible from track_points where individual_id = ${id} order by ts` as any) as Array<{ ts: string; lat: number; lon: number; visible: boolean }>;
    const raw: RawPoint[] = pts.filter((p) => p.visible !== false).map((p) => ({ ts: p.ts, lon: p.lon, lat: p.lat }));
    const track = reconstructTrack(raw);
    if (track) {
      await db.update(individuals).set({
        pointCount: track.pointCount, distanceKm: track.distanceKm, bbox: track.bbox,
        trackStart: track.trackStart, trackEnd: track.trackEnd,
      }).where(eq(individuals.id, id));

      // Rebuild cached story GeoJSON if this animal has a story.
      const st = await db.select({ id: stories.id }).from(stories).where(eq(stories.individualId, id));
      if (st.length) {
        const geojson = {
          type: "FeatureCollection" as const, bbox: track.bbox,
          features: [track.simplified], properties: { timeline: downsample(track.timeline, 2000) },
        };
        await db.update(stories).set({ geojson }).where(eq(stories.individualId, id));
      }
    }
    if (++done % 200 === 0) process.stdout.write(`.${done}`);
  }

  const after = Number((await sql`select count(*)::bigint n from track_points` as any)[0].n);
  console.log(`\n\n✓ Thinned: ${before.toLocaleString()} → ${after.toLocaleString()} points ` +
    `(${(100 * (1 - after / before)).toFixed(1)}% smaller)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
