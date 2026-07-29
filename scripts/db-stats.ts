// Quick health snapshot of the local PGlite database.
// Usage: pnpm tsx scripts/db-stats.ts
import "dotenv/config";
import { sql, client } from "../db/index";

const one = async (q: Promise<any[]>) => (await q)[0];
const pad = (v: any, n: number) => String(v).padStart(n);

async function main() {
  const tot = await one(sql`
    select (select count(*)::int from individuals) animals,
           (select count(distinct scientific_name)::int from individuals where scientific_name is not null) species,
           (select count(*)::int from track_points) points,
           (select count(*)::int from datasets) datasets`);
  console.log("TOTALS:", tot);

  console.log("\nBy source:");
  const bySrc = await sql`
    select d.source, count(distinct i.id)::int animals,
           count(distinct i.scientific_name)::int species,
           sum(coalesce(i.point_count,0))::int points
    from datasets d join individuals i on i.dataset_id = d.id
    group by d.source order by animals desc`;
  for (const r of bySrc) console.log(" ", String(r.source).padEnd(16), pad(r.animals, 7), "animals", pad(r.species, 5), "sp", pad(r.points, 9), "pts");

  console.log("\nData quality:");
  console.log(" ", await one(sql`
    select count(*)::int total,
           count(*) filter (where scientific_name is null)::int no_species,
           count(*) filter (where coalesce(point_count,0) < 20)::int thin_lt20,
           count(*) filter (where coalesce(point_count,0) = 0)::int empty
    from individuals`));

  console.log("\nTop 12 species by animals tracked:");
  const top = await sql`
    select scientific_name, count(*)::int n, sum(coalesce(point_count,0))::int pts
    from individuals where scientific_name is not null
    group by scientific_name order by n desc limit 12`;
  for (const r of top) console.log(" ", String(r.scientific_name).padEnd(32), pad(r.n, 5), "animals", pad(r.pts, 8), "pts");

  console.log("\nShift layer:", await one(sql`
    select (select count(*)::int from species_shifts) shift_rows,
           (select count(distinct s.scientific_name)::int from species_shifts s
              join individuals i on lower(i.scientific_name) = lower(s.scientific_name)) tracked_with_shift`));

  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
