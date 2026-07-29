// Coverage audit: how many species do we hold, and how are they distributed
// taxonomically? Classifies each distinct species via the GBIF backbone (class),
// so we can see the skew and judge what's realistically missing. Cached.
//
// Usage: pnpm tsx scripts/species-coverage.ts
import "dotenv/config";
import { sql, client } from "../db/index";

async function gbifClass(name: string): Promise<{ kingdom?: string; phylum?: string; class?: string }> {
  try {
    const m = await (await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15000) })).json();
    return { kingdom: m.kingdom, phylum: m.phylum, class: m.class };
  } catch { return {}; }
}

async function main() {
  const rows = (await sql`
    select scientific_name sp, count(*)::int animals, sum(coalesce(point_count,0))::int pts
    from individuals where scientific_name is not null
    group by scientific_name order by animals desc`) as any[];
  console.log(`Distinct named species: ${rows.length}\n(classifying via GBIF…)\n`);

  const byClass = new Map<string, { species: number; animals: number; pts: number }>();
  let nonAnimal = 0;
  for (const r of rows) {
    const g = await gbifClass(r.sp);
    const key = g.kingdom && g.kingdom !== "Animalia" ? `NON-ANIMAL (${g.kingdom})` : (g.class || "Unknown");
    if (g.kingdom && g.kingdom !== "Animalia") nonAnimal++;
    const e = byClass.get(key) ?? { species: 0, animals: 0, pts: 0 };
    e.species++; e.animals += r.animals; e.pts += r.pts;
    byClass.set(key, e);
  }

  console.log("By taxonomic class:");
  const sorted = [...byClass.entries()].sort((a, b) => b[1].species - a[1].species);
  for (const [cls, e] of sorted) {
    console.log(`  ${cls.padEnd(24)} ${String(e.species).padStart(4)} species  ${String(e.animals).padStart(6)} animals  ${(e.pts / 1e6).toFixed(2)}M pts`);
  }
  console.log(`\nTotal: ${rows.length} species. Non-animal (junk to prune): ${nonAnimal}.`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
