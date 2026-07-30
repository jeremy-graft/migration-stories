// Single-animal worked example — the template for a mammal "story". Picks the
// richest individual of a species, reconstructs its journey (distance, duration,
// how far it roamed, displacement, pace), and exports a GeoJSON track for the
// eventual map. This is the unit a story is built on: one real animal, one path.
//
// Usage: pnpm tsx scripts/story-candidate.ts ["Scientific name"]
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";
import { sql, client } from "../db/index";

const fmt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// telemetry is a modern era; anything outside this is a corrupt timestamp
const T_LO = "1970-01-01", T_HI = "2027-01-01";

async function main() {
  const species = process.argv[2] || "Mirounga leonina";
  const tops = (await sql`
    select i.id, i.source_individual_id sid, i.name, i.distance_km dist, i.point_count pc,
           i.track_start ts, i.track_end te, i.bbox, d.title, d.source
    from individuals i join datasets d on d.id = i.dataset_id
    where lower(i.scientific_name) = lower(${species}) and i.distance_km is not null
      and i.track_start >= ${T_LO} and i.track_end <= ${T_HI} and i.track_end > i.track_start
    order by i.distance_km desc limit 8`) as any[];
  if (!tops.length) { console.log(`No tracks for ${species}.`); await client.close(); process.exit(0); }

  console.log(`\n=== ${species} — richest individual tracks (clean timestamps) ===`);
  for (const t of tops) {
    const days = t.ts && t.te ? Math.round((+new Date(t.te) - +new Date(t.ts)) / 86400000) : 0;
    console.log(`  ${String(t.name || t.sid).slice(0, 22).padEnd(22)} ${fmt(t.dist).padStart(7)} km  ${String(t.pc).padStart(4)} fixes  ${fmt(days).padStart(5)} days  [${t.source}]`);
  }

  const hero = tops[0];
  const pts = (await sql`select ts, lon, lat from track_points where individual_id = ${hero.id} and visible and ts >= ${T_LO} and ts <= ${T_HI} order by ts`) as any[];
  if (pts.length < 2) { console.log("hero track too short"); await client.close(); process.exit(0); }

  const coords = pts.map((p) => [p.lon, p.lat] as [number, number]);
  const line = turf.lineString(coords);
  const distKm = turf.length(line, { units: "kilometers" });
  const start = pts[0], end = pts[pts.length - 1];
  const displacementKm = turf.distance([start.lon, start.lat], [end.lon, end.lat], { units: "kilometers" });
  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
  const days = Math.round((+new Date(end.ts) - +new Date(start.ts)) / 86400000) || 1;
  const southmost = Math.min(...lats), northmost = Math.max(...lats);

  console.log(`\n★ HERO: ${hero.name || hero.sid}  (${species})`);
  console.log(`   dataset: ${String(hero.title).slice(0, 60)} [${hero.source}]`);
  console.log(`   journey: ${fmt(distKm)} km over ${fmt(days)} days  (~${(distKm / days).toFixed(1)} km/day)`);
  console.log(`   ${pts.length} fixes · ${new Date(start.ts).toISOString().slice(0, 10)} → ${new Date(end.ts).toISOString().slice(0, 10)}`);
  console.log(`   start: ${start.lat.toFixed(2)}, ${start.lon.toFixed(2)}   end: ${end.lat.toFixed(2)}, ${end.lon.toFixed(2)}`);
  console.log(`   latitude range: ${southmost.toFixed(2)}° → ${northmost.toFixed(2)}°  (spanned ${(northmost - southmost).toFixed(1)}° lat)`);
  console.log(`   straight-line displacement start→end: ${fmt(displacementKm)} km`);
  console.log(`   → round-trip index: ${(distKm / Math.max(displacementKm, 1)).toFixed(1)}× the direct distance (1 = one-way, high = looping/foraging)`);

  const dir = fileURLToPath(new URL("../exports", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const slug = `${species.replace(/\s+/g, "_")}_${String(hero.name || hero.sid).replace(/[^\w]+/g, "-")}`;
  const feature = {
    type: "Feature",
    properties: { species, animal: hero.name || hero.sid, distanceKm: Math.round(distKm), days, fixes: pts.length, start: start.ts, end: end.ts },
    geometry: line.geometry,
  };
  const path = `${dir}/${slug}.geojson`;
  writeFileSync(path, JSON.stringify(feature));
  console.log(`\n   ✓ track exported → exports/${slug}.geojson  (${(JSON.stringify(feature).length / 1024).toFixed(0)} KB, ready to map)`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
