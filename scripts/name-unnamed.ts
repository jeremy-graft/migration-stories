// Deep species-naming pass for unnamed individuals. The ingesters store a
// species only when they can detect one in the CSV or the dataset title; ~2.7k
// animals came in nameless. This goes back to the SOURCE metadata (Zenodo
// keywords/description, Dryad abstract/keywords) — a far richer signal than the
// title alone — extracts a binomial, GBIF-validates it, and fills the name.
//
// Only Zenodo/Dryad deposit datasets (id `zenodo:` / `dryad:`); Movebank
// multi-taxon studies are genuinely ambiguous and left alone. Fills NULLs only.
//
// Usage: pnpm tsx scripts/name-unnamed.ts         # dry-run
//        pnpm tsx scripts/name-unnamed.ts --fix    # apply
import "dotenv/config";
import { sql, client } from "../db/index";
import { speciesFromText } from "../lib/csv-tracks";

interface DS { id: string; title: string; doi: string | null; unnamed: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Strict GBIF match: accept ONLY vertebrates (phylum Chordata). Deposit metadata
// is littered with non-target species — the plant being pollinated, the prey in
// the abstract — and our DB is ~all vertebrates, so this gate kills those false
// positives (canola on a bee study, a tree on a bat study) while keeping every
// real bird/mammal/fish/reptile. Rare genuinely-tracked insects are left unnamed
// rather than risk a wrong name. (Local, not the shared validSpecies, so the
// ingesters' broader taxon support is unaffected.)
const vertCache = new Map<string, string | null>();
async function vertebrateSpecies(name?: string): Promise<string | undefined> {
  const key = (name || "").trim();
  if (!key || key.length < 4) return undefined;
  if (vertCache.has(key)) return vertCache.get(key) ?? undefined;
  let val: string | null = null;
  try {
    const m = await (await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) })).json();
    if (m && m.matchType !== "NONE" && m.phylum === "Chordata" && (m.rank === "SPECIES" || m.rank === "SUBSPECIES" || m.species)) {
      val = m.species || m.scientificName || key;
    }
  } catch { /* leave null */ }
  vertCache.set(key, val);
  return val ?? undefined;
}

// Fetch candidate name-bearing strings (title, keywords, description/abstract)
// from the deposit's source API. Returns [] on any failure (skip, don't crash).
async function candidateTexts(ds: DS): Promise<string[]> {
  try {
    if (ds.id.startsWith("zenodo:")) {
      const id = ds.id.slice("zenodo:".length);
      await sleep(700); // be gentle with Zenodo
      const m = (await (await fetch(`https://zenodo.org/api/records/${id}`, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(30000) })).json())?.metadata ?? {};
      const subjects = (m.subjects ?? []).map((s: any) => s?.term).filter(Boolean);
      return [m.title, ...(m.keywords ?? []), ...subjects, (m.description || "").replace(/<[^>]+>/g, " ").slice(0, 400)].filter(Boolean);
    }
    if (ds.id.startsWith("dryad:")) {
      const doi = ds.id.slice("dryad:".length);
      await sleep(2200); // Dryad rate limit
      const m = await (await fetch(`https://datadryad.org/api/v2/datasets/${encodeURIComponent("doi:" + doi)}`, { headers: { "User-Agent": "migration-stories/0.1", Accept: "application/json" }, signal: AbortSignal.timeout(30000) })).json();
      return [m.title, ...(m.keywords ?? []), (m.abstract || "").replace(/<[^>]+>/g, " ").slice(0, 400)].filter(Boolean);
    }
  } catch { /* skip */ }
  return [];
}

// From the candidate strings, find the first GBIF-valid species. Keywords are
// often the exact binomial, so try each keyword directly AND a binomial sniff.
async function resolveSpecies(texts: string[]): Promise<string | undefined> {
  const tries: string[] = [];
  for (const t of texts) {
    const bin = speciesFromText(t);
    if (bin) tries.push(bin);
    // a short keyword may itself be the scientific name
    if (t.length <= 40 && /^[A-Z][a-z]+ [a-z]+/.test(t.trim())) tries.push(t.trim());
  }
  const seen = new Set<string>();
  for (const cand of tries) {
    const key = cand.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    const v = await vertebrateSpecies(cand);
    if (v) return v;
  }
  return undefined;
}

async function main() {
  const fix = process.argv.includes("--fix");
  const datasets = (await sql`
    select d.id, d.title, d.doi, count(*)::int unnamed
    from individuals i join datasets d on d.id = i.dataset_id
    where i.scientific_name is null and (d.id like 'zenodo:%' or d.id like 'dryad:%')
    group by d.id, d.title, d.doi
    order by unnamed desc
  `) as DS[];
  console.log(`Deposit datasets with unnamed individuals: ${datasets.length}`);

  let named = 0, animals = 0, unresolved = 0;
  for (const d of datasets) {
    const texts = await candidateTexts(d);
    const species = await resolveSpecies(texts);
    if (!species) { unresolved++; continue; }
    named++; animals += d.unnamed;
    console.log(`  ${species.padEnd(30)} ← ${String(d.unnamed).padStart(4)} animal(s)  ${d.id.slice(0, 22)}  "${(d.title || "").slice(0, 34)}"`);
    if (fix) {
      await sql`update individuals set scientific_name = ${species} where dataset_id = ${d.id} and scientific_name is null`;
      await sql`update datasets set taxa = (
        select array_agg(distinct x) from unnest(coalesce(taxa, '{}'::text[]) || array[${species}]::text[]) x
      ) where id = ${d.id}`;
    }
  }

  console.log(`\n${fix ? "✓ Named" : "(dry-run) would name"} ${animals.toLocaleString()} animals across ${named} datasets. ${unresolved} still unresolved.`);
  if (!fix && named) console.log("Re-run with --fix to apply.");
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
