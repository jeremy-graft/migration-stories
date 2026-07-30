// Cross-source de-duplication. The same physical animal can be ingested twice
// when one study is indexed by multiple sources (e.g. INBO gulls live in BOTH
// GBIF and Movebank) — inflating the animal/point counts. This finds individuals
// that are the SAME animal across DIFFERENT sources and keeps only the richest.
//
// Conservative match (low false-positive risk): identical scientific_name AND
// identical source_individual_id (the tag id) AND overlapping track timespan,
// where the two come from different `source`s.
//
// Usage:
//   pnpm tsx scripts/dedup-individuals.ts        # dry-run (report only)
//   pnpm tsx scripts/dedup-individuals.ts --fix  # delete the duplicate copies
import "dotenv/config";
import { inArray } from "drizzle-orm";
import { db, sql } from "../db/index";
import { individuals, trackPoints } from "../db/schema";

interface Row { id: string; sid: string; sci: string; pc: number; ts: string | null; te: string | null; src: string }

const overlaps = (a: Row, b: Row) => {
  // timespans overlap, or starts within 60 days (telemetry of the same animal)
  if (!a.ts || !a.te || !b.ts || !b.te) return true; // missing dates → don't block a same-id match
  const as = +new Date(a.ts), ae = +new Date(a.te), bs = +new Date(b.ts), be = +new Date(b.te);
  return as <= be && bs <= ae;
};

async function main() {
  const fix = process.argv.includes("--fix");
  const rows = (await sql`
    select i.id, i.source_individual_id sid, i.scientific_name sci,
           coalesce(i.point_count,0) pc, i.track_start ts, i.track_end te, d.source src
    from individuals i join datasets d on d.id = i.dataset_id
    where i.scientific_name is not null and i.source_individual_id is not null and i.source_individual_id <> ''
  `) as Row[];
  console.log(`Scanning ${rows.length.toLocaleString()} identified individuals…`);

  // group by species + tag id
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.sci.toLowerCase()}|${r.sid.toLowerCase()}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const losers: string[] = [];
  const bySrcPair = new Map<string, number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (new Set(g.map((r) => r.src)).size < 2) continue; // must span >1 source
    // cluster members that overlap in time with the richest; keep richest, drop rest
    const sorted = [...g].sort((a, b) => b.pc - a.pc);
    const keep = sorted[0];
    for (const r of sorted.slice(1)) {
      if (r.src === keep.src) continue;          // same-source siblings aren't cross-source dupes
      if (!overlaps(keep, r)) continue;
      losers.push(r.id);
      const pair = [keep.src, r.src].sort().join(" + ");
      bySrcPair.set(pair, (bySrcPair.get(pair) ?? 0) + 1);
    }
  }

  console.log(`\nDuplicate individuals (same species+tag across sources): ${losers.length}`);
  for (const [pair, n] of [...bySrcPair.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pair}: ${n}`);

  if (!losers.length) { console.log("\nNothing to dedupe."); process.exit(0); }
  if (!fix) { console.log(`\n(dry-run) re-run with --fix to delete these ${losers.length} duplicate copies + their points.`); process.exit(0); }

  const [{ p: ptsBefore }] = (await sql`select count(*)::int p from track_points`) as any[];
  console.log(`\nDeleting ${losers.length} duplicate individuals + their track points…`);
  const CHUNK = 500;
  for (let i = 0; i < losers.length; i += CHUNK) {
    const batch = losers.slice(i, i + CHUNK);
    await db.delete(trackPoints).where(inArray(trackPoints.individualId, batch));
    await db.delete(individuals).where(inArray(individuals.id, batch));
    process.stdout.write(".");
  }
  const [{ a, s, p }] = (await sql`select count(*)::int a, count(distinct scientific_name)::int s, (select count(*)::int from track_points) p from individuals`) as any[];
  console.log(`\n✓ Removed ${losers.length} duplicate animals (${(Number(ptsBefore) - Number(p)).toLocaleString()} points). Now: ${a.toLocaleString()} animals · ${s} species · ${Number(p).toLocaleString()} points.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
