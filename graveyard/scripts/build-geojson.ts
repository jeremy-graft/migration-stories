// Regenerate cached GeoJSON render artifacts for every story from the
// full-resolution track_points in the DB. Run after ingestion changes.
//
// Usage: pnpm build-geojson
import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { stories, trackPoints } from "../db/schema";
import { reconstructTrack, type RawPoint } from "../lib/track";

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1];
  return out;
}

async function main() {
  const all = await db.select().from(stories);
  console.log(`Rebuilding GeoJSON for ${all.length} story(ies)…`);

  for (const story of all) {
    const pts = await db
      .select({ ts: trackPoints.ts, lon: trackPoints.lon, lat: trackPoints.lat, visible: trackPoints.visible })
      .from(trackPoints)
      .where(eq(trackPoints.individualId, story.individualId))
      .orderBy(asc(trackPoints.ts));

    const raw: RawPoint[] = pts
      .filter((p) => p.visible !== false)
      .map((p) => ({ ts: p.ts, lon: p.lon, lat: p.lat }));

    const track = reconstructTrack(raw);
    if (!track) { console.log(`  ${story.slug}: no usable track, skipped`); continue; }

    const geojson = {
      type: "FeatureCollection" as const,
      bbox: track.bbox,
      features: [track.simplified],
      properties: { timeline: downsample(track.timeline, 2000) },
    };
    await db.update(stories).set({ geojson }).where(eq(stories.id, story.id));
    console.log(`  ${story.slug}: ${track.pointCount} pts → ${track.simplified.geometry.coordinates.length} simplified`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
