// Story menu — for a curated set of charismatic species, find each one's single
// most epic CLEAN individual journey (from the stored metrics), and rank them.
// A buffet of ready-to-tell candidates. Uses bbox for latitude span, so it's fast
// (no per-point scan). Defaults to charismatic mammals + a few iconic others.
//
// Usage: pnpm tsx scripts/story-menu.ts
import "dotenv/config";
import { sql, client } from "../db/index";

// [scientific, common]
const CANDIDATES: [string, string][] = [
  ["Mirounga leonina", "southern elephant seal"], ["Rangifer tarandus", "caribou"],
  ["Canis lupus", "grey wolf"], ["Balaena mysticetus", "bowhead whale"],
  ["Balaenoptera musculus", "blue whale"], ["Megaptera novaeangliae", "humpback whale"],
  ["Monodon monoceros", "narwhal"], ["Physeter macrocephalus", "sperm whale"],
  ["Loxodonta africana", "savanna elephant"], ["Loxodonta cyclotis", "forest elephant"],
  ["Tapirus terrestris", "lowland tapir"], ["Panthera leo", "lion"],
  ["Puma concolor", "puma"], ["Odobenus rosmarus", "walrus"],
  ["Ursus maritimus", "polar bear"], ["Gulo gulo", "wolverine"],
  ["Vulpes lagopus", "arctic fox"], ["Alces alces", "moose"],
  ["Chelonia mydas", "green turtle"], ["Diomedea exulans", "wandering albatross"],
];

async function main() {
  const rows: any[] = [];
  for (const [sci, common] of CANDIDATES) {
    const [best] = (await sql`
      select i.name, i.source_individual_id sid, i.distance_km dist, i.point_count pc,
             i.track_start ts, i.track_end te, i.bbox, d.source
      from individuals i join datasets d on d.id = i.dataset_id
      where lower(i.scientific_name) = lower(${sci})
        and i.distance_km is not null and i.point_count >= 20
        and i.track_start >= '1970-01-01' and i.track_end <= '2027-01-01'
        and (i.track_end - i.track_start) < interval '2200 days'  -- no single tag lasts >6y; longer = residual ts corruption
      order by i.distance_km desc limit 1`) as any[];
    if (!best) continue;
    const days = Math.max(1, Math.round((+new Date(best.te) - +new Date(best.ts)) / 86400000));
    const latSpan = best.bbox ? Math.abs(best.bbox[3] - best.bbox[1]) : 0;
    rows.push({ sci, common, animal: best.name || best.sid, dist: best.dist, days, kmday: best.dist / days, latSpan, pc: best.pc, source: best.source });
  }
  rows.sort((a, b) => b.dist - a.dist);

  console.log(`\n=== MAMMAL STORY MENU — best clean journey per species (${rows.length} of ${CANDIDATES.length} available) ===\n`);
  console.log("  " + "species".padEnd(26) + "distance".padStart(10) + "days".padStart(7) + "km/day".padStart(8) + "lat°".padStart(7) + "  best animal");
  for (const r of rows) {
    console.log(
      `  ${r.common.padEnd(26)}${(Math.round(r.dist).toLocaleString("en-US") + " km").padStart(10)}${String(r.days).padStart(7)}${r.kmday.toFixed(0).padStart(8)}${r.latSpan.toFixed(0).padStart(7)}  ${String(r.animal).slice(0, 20)} [${r.source}]`,
    );
  }
  console.log(`\nPick one and I'll pull its full track + put it on a map.`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
