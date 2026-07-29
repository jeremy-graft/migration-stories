// Prune non-animal "species" (plants/fungi that leaked in from messy deposits)
// and the stray human-movement dataset — they inflate the species count and
// pollute analysis. GBIF-classify each species; target kingdom Plantae/Fungi/etc.
// and Homo sapiens. Deletes their individuals + track points (+ any stories).
//
// Usage: pnpm tsx scripts/prune-junk.ts        # dry-run
//        pnpm tsx scripts/prune-junk.ts --fix
import "dotenv/config";
import { inArray } from "drizzle-orm";
import { db, sql, client } from "../db/index";
import { individuals, trackPoints, stories } from "../db/schema";

async function gbifKingdom(name: string): Promise<string | undefined> {
  try {
    const m = await (await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15000) })).json();
    return m.kingdom;
  } catch { return undefined; }
}

async function main() {
  const fix = process.argv.includes("--fix");
  const rows = (await sql`
    select scientific_name sp, count(*)::int animals from individuals
    where scientific_name is not null group by scientific_name`) as any[];

  const targets: { sp: string; animals: number; why: string }[] = [];
  for (const r of rows) {
    if (r.sp === "Homo sapiens") { targets.push({ sp: r.sp, animals: r.animals, why: "human dataset" }); continue; }
    const k = await gbifKingdom(r.sp);
    if (k && k !== "Animalia") targets.push({ sp: r.sp, animals: r.animals, why: `kingdom ${k}` });
  }

  console.log(`Junk species to prune: ${targets.length}`);
  for (const t of targets) console.log(`  ${t.sp.padEnd(30)} ${String(t.animals).padStart(4)} animals  (${t.why})`);
  if (!targets.length) { console.log("Nothing to prune."); await client.close(); process.exit(0); }

  if (!fix) { console.log("\n(dry-run) re-run with --fix to delete these."); await client.close(); process.exit(0); }

  const names = targets.map((t) => t.sp);
  const ids = (await db.select({ id: individuals.id }).from(individuals).where(inArray(individuals.scientificName, names))).map((r) => r.id);
  console.log(`\nDeleting ${ids.length} individuals + their points…`);
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    await db.delete(stories).where(inArray(stories.individualId, batch));
    await db.delete(trackPoints).where(inArray(trackPoints.individualId, batch));
    await db.delete(individuals).where(inArray(individuals.id, batch));
  }
  const [{ s }] = (await sql`select count(distinct scientific_name)::int s from individuals where scientific_name is not null`) as any[];
  console.log(`✓ Pruned. Species now: ${s}.`);
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
