// Corpus exploration — "what angles does this data actually support?" No stories,
// no assumptions. Just: how deep in time do we reach, which species have the
// multi-decade depth that trend/climate analysis needs, and which show the strong
// seasonal movement that migration/phenology work needs. Evidence for choosing
// where to dig (and what external data — weather/climate/terrain — would pay off).
import "dotenv/config";
import { sql, client } from "../db/index";

async function main() {
  // 1. temporal reach — points per 5-year bucket
  const era = (await sql`
    select (floor(extract(year from ts) / 5) * 5)::int bucket, count(*)::int n,
           count(distinct individual_id)::int inds
    from track_points where visible and ts >= '1970-01-01' and ts < '2027-01-01'
    group by bucket order by bucket`) as any[];
  console.log("=== Temporal reach (points & animals per 5-yr era) ===");
  const maxN = Math.max(...era.map((e) => e.n));
  for (const e of era) console.log(`  ${e.bucket}s  ${"█".repeat(Math.round((e.n / maxN) * 40)).padEnd(40)} ${(e.n / 1e6).toFixed(2)}M pts · ${e.inds.toLocaleString()} animals`);

  // 2. multi-decade species — the trend/climate-capable subset
  const decadal = (await sql`
    with sp as (
      select i.scientific_name sp,
             min(extract(year from tp.ts)) y0, max(extract(year from tp.ts)) y1,
             count(distinct extract(year from tp.ts))::int yrs,
             count(distinct i.id)::int inds, count(*)::int pts
      from track_points tp join individuals i on i.id = tp.individual_id
      where tp.visible and tp.ts >= '1970-01-01' and tp.ts < '2027-01-01' and i.scientific_name is not null
      group by i.scientific_name)
    select sp, (y1 - y0)::int span, yrs, inds, pts from sp
    where (y1 - y0) >= 15 and yrs >= 10 and inds >= 20
    order by span desc, inds desc`) as any[];
  console.log(`\n=== Multi-decade species (span ≥15y, ≥10 distinct yrs, ≥20 animals): ${decadal.length} ===`);
  console.log("   (this is the subset where climate/trend analysis is actually viable)");
  for (const d of decadal.slice(0, 20))
    console.log(`  ${String(d.sp).padEnd(28)} ${d.span}y span  ${String(d.yrs).padStart(2)} yrs  ${String(d.inds).padStart(5)} animals  ${(d.pts / 1000).toFixed(0)}k pts`);
  if (decadal.length > 20) console.log(`  …and ${decadal.length - 20} more`);

  // 3. strong seasonal movers — migration/phenology candidates
  const seasonal = (await sql`
    with m as (
      select i.scientific_name sp, extract(month from tp.ts)::int mon, avg(tp.lat) mlat, count(*)::int n
      from track_points tp join individuals i on i.id = tp.individual_id
      where tp.visible and i.scientific_name is not null
      group by i.scientific_name, extract(month from tp.ts)
      having count(*) >= 30)
    select sp, (max(mlat) - min(mlat)) amp, count(*)::int months, sum(n)::int pts
    from m group by sp having count(*) >= 8
    order by amp desc limit 15`) as any[];
  console.log(`\n=== Strongest seasonal latitude swing (migration/phenology candidates) ===`);
  for (const s of seasonal)
    console.log(`  ${String(s.sp).padEnd(28)} ${Number(s.amp).toFixed(1).padStart(5)}° seasonal swing  (${s.months} months sampled, ${(s.pts / 1000).toFixed(0)}k pts)`);

  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
