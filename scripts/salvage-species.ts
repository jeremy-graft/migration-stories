// Salvage unnamed individuals. ~2.3k animals were ingested without a species
// (fuzzy CSVs where the species column wasn't found, or multi-taxon Movebank
// studies). We recover a name where we can do so confidently:
//   • Movebank/any dataset whose `taxa` has exactly ONE species → use it.
//   • Otherwise infer a binomial from the dataset title and GBIF-validate it.
// Only fills currently-NULL names; never overwrites. GBIF-validated so we don't
// invent species. Dry-run by default.
//
// Usage: pnpm tsx scripts/salvage-species.ts         # report
//        pnpm tsx scripts/salvage-species.ts --fix    # apply
import "dotenv/config";
import { db, sql, client } from "../db/index";
import { speciesFromText, validSpecies } from "../lib/csv-tracks";

interface DS { id: string; title: string; taxa: string[] | null; source: string; unnamed: number }

async function main() {
  const fix = process.argv.includes("--fix");
  const datasets = (await sql`
    select d.id, d.title, d.taxa, d.source, count(*)::int unnamed
    from individuals i join datasets d on d.id = i.dataset_id
    where i.scientific_name is null
    group by d.id, d.title, d.taxa, d.source
    order by unnamed desc
  `) as DS[];
  console.log(`Datasets with unnamed individuals: ${datasets.length}`);

  let salvaged = 0, animals = 0, bySingleTaxon = 0, byTitle = 0, unresolved = 0;
  for (const d of datasets) {
    // candidate species: a lone taxon on the dataset, else a binomial in the title
    let candidate: string | undefined;
    if (d.taxa && d.taxa.length === 1) candidate = d.taxa[0];
    else candidate = speciesFromText(d.title);

    const species = await validSpecies(candidate);
    if (!species) { unresolved++; continue; }
    if (d.taxa && d.taxa.length === 1) bySingleTaxon++; else byTitle++;
    salvaged++; animals += d.unnamed;
    console.log(`  ${species.padEnd(30)} ← ${d.unnamed} animal(s)  [${d.source}] ${d.title.slice(0, 40)}`);

    if (fix) {
      await sql`update individuals set scientific_name = ${species} where dataset_id = ${d.id} and scientific_name is null`;
      await sql`update datasets set taxa = (
        select array_agg(distinct x) from unnest(coalesce(taxa, '{}'::text[]) || array[${species}]::text[]) x
      ) where id = ${d.id}`;
    }
  }

  console.log(`\n${fix ? "✓ Salvaged" : "(dry-run) would salvage"} ${animals.toLocaleString()} animals across ${salvaged} datasets ` +
    `(${bySingleTaxon} via single-taxon, ${byTitle} via title). ${unresolved} datasets unresolved.`);
  if (!fix && salvaged) console.log("Re-run with --fix to apply.");
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
