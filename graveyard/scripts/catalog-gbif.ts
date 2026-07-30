// CATALOG — enumerate ALL openly-licensed (CC0 / CC-BY) animal-telemetry
// datasets on GBIF and record their metadata, WITHOUT pulling track points.
// Answers "how much is there, and how much is gettable" before any bulk ingest.
//
// Method: facet GBIF's open machine-observation occurrences by datasetKey (one
// call per license enumerates every dataset carrying telemetry, with counts),
// then per dataset fetch metadata + its top species (resolving each species'
// taxonomic class for PRECISE taxon grouping). Upserts into `datasets`
// (a dataset with no individuals/points = catalogued but not yet ingested).
// Emits CATALOG.md.
//
// NOTE: basisOfRecord=MACHINE_OBSERVATION is a proxy for telemetry; it also
// includes acoustic receivers and camera traps. We classify telemetry type from
// taxon + title so the migration-relevant (GPS bird/mammal) subset is visible.
//
// Usage: pnpm catalog-gbif
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { db, sql } from "../db/index";
import { datasets } from "../db/schema";
import { gbifFacet, gbifDataset, gbifOrganizationTitle, gbifSpecies } from "../lib/sources/gbif";
import { normalizeLicense, isCommercialSafe, type License } from "../lib/licenses";

const GBIF_LICENSES = ["CC0_1_0", "CC_BY_4_0"] as const;
const CONCURRENCY = 6;

interface CatalogEntry {
  key: string;
  title: string;
  publisher?: string;
  license: License;
  doi?: string;
  records: number;     // machine-observation records (telemetry proxy)
  telemetry: string;   // gps/argos | acoustic | imaging/camera | gps/other
  taxon: string;       // bird | mammal | fish/inverts | reptile | amphibian | insect | other/unknown
  species: string[];   // top species scientific names
}

/** Map a GBIF taxonomic class to a coarse group. */
function classToGroup(cls?: string): string | undefined {
  if (!cls) return undefined;
  if (cls === "Aves") return "bird";
  if (cls === "Mammalia") return "mammal";
  if (["Actinopterygii", "Chondrichthyes", "Elasmobranchii", "Teleostei", "Petromyzonti",
       "Malacostraca", "Cephalopoda", "Bivalvia", "Gastropoda"].includes(cls)) return "fish/inverts";
  if (cls === "Reptilia") return "reptile";
  if (cls === "Amphibia") return "amphibian";
  if (cls === "Insecta") return "insect";
  return undefined;
}

/** Fallback taxon classification from the dataset title. */
function taxonFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/gull|stork|spoonbill|curlew|harrier|kestrel|eagle|goose|geese|duck|tern|oystercatcher|godwit|crane|raptor|owl|\bbird|avian|passerine|wader|shorebird|petrel|albatross|gannet|swan|heron|ibis|falcon|buzzard|vulture/.test(t)) return "bird";
  if (/salmon|sturgeon|\bcod\b|crab|lobster|\bbass\b|\beel\b|shark|\bray\b|\bfish|trout|tuna|pike|carp|mackerel|sole|plaice|perch/.test(t)) return "fish/inverts";
  if (/seal|whale|dolphin|cetacean|\bbat\b|deer|\bfox\b|wolf|bear|elephant|lion|mammal|rodent|hare|boar|badger|otter|lynx/.test(t)) return "mammal";
  if (/turtle|tortoise|snake|lizard|reptile|crocodile/.test(t)) return "reptile";
  return "other/unknown";
}

/** Telemetry type from taxon + title. Open fish telemetry is acoustic; GPS/Argos is bird/mammal/reptile. */
function telemetryType(title: string, taxon: string): string {
  const t = title.toLowerCase();
  if (/camera|\btrap\b|imaging|plankton|image dataset|\bvideo/.test(t)) return "imaging/camera";
  if (/acoustic|hydrophone|receiver|passive acou|\bvr2|silic|detection array/.test(t)) return "acoustic";
  if (taxon === "fish/inverts") return "acoustic";
  if (taxon === "bird" || taxon === "mammal" || taxon === "reptile") return "gps/argos";
  return "gps/other";
}

/** Bounded-concurrency map with progress dots. */
async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0, done = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      res[idx] = await fn(items[idx]);
      if (++done % 25 === 0) process.stdout.write(`.${done}`);
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return res;
}

async function processDataset(key: string, records: number): Promise<CatalogEntry | null> {
  try {
    const meta = await gbifDataset(key);
    const license = normalizeLicense(meta.license);
    if (!isCommercialSafe(license)) return null; // metadata license is authoritative
    const publisher = (await gbifOrganizationTitle(meta.publisherKey)) ?? meta.publisher;

    // Top species in this dataset → names + classes (precise taxon).
    const spFacet = await gbifFacet({ datasetKey: key, basisOfRecord: "MACHINE_OBSERVATION" }, "speciesKey", 3);
    const species: string[] = [];
    const classes: string[] = [];
    for (const s of spFacet) {
      const info = await gbifSpecies(s.name);
      if (info.name) species.push(info.name);
      if (info.class) classes.push(info.class);
    }
    const taxon = classToGroup(classes[0]) ?? taxonFromTitle(meta.title);
    const telemetry = telemetryType(meta.title, taxon);

    await db.insert(datasets).values({
      id: `gbif:${key}`, source: "gbif", title: meta.title, doi: meta.doi, license,
      citation: meta.citation, publisher, taxa: species, telemetryType: telemetry, taxonGroup: taxon,
      recordCount: records, raw: meta.raw as object,
    }).onConflictDoUpdate({
      target: datasets.id,
      set: {
        title: meta.title, doi: meta.doi, license, citation: meta.citation,
        publisher, taxa: species, telemetryType: telemetry, taxonGroup: taxon,
        recordCount: records, raw: meta.raw as object,
      },
    });

    return { key, title: meta.title, publisher, license, doi: meta.doi, records, telemetry, taxon, species };
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n=== Cataloguing open GBIF telemetry datasets (no auth) ===\n");

  // 1. Enumerate datasets + species per license via facets.
  const speciesPerLicense: Record<string, number> = {};
  const datasetCounts = new Map<string, number>();
  for (const lic of GBIF_LICENSES) {
    const q = { basisOfRecord: "MACHINE_OBSERVATION", license: lic };
    const dsFacet = await gbifFacet(q, "datasetKey", 1500);
    const spFacet = await gbifFacet(q, "speciesKey", 1500);
    speciesPerLicense[lic] = spFacet.length;
    for (const d of dsFacet) datasetCounts.set(d.name, d.count);
    console.log(`  ${lic}: ${dsFacet.length} datasets, ${spFacet.length}${spFacet.length >= 1500 ? "+" : ""} species`);
  }
  console.log(`\nTotal distinct datasets: ${datasetCounts.size}. Enriching (species + class)…\n`);

  // 2. Enrich + upsert (bounded concurrency).
  const items = [...datasetCounts].map(([key, records]) => ({ key, records }));
  const results = await mapPool(items, CONCURRENCY, (it) => processDataset(it.key, it.records));
  const entries = results.filter((e): e is CatalogEntry => e !== null);
  console.log(`\n\nCatalogued ${entries.length} datasets (${items.length - entries.length} skipped).\n`);

  // 3. Report.
  const [{ n: totalDatasets }] = await sql`select count(*)::int n from datasets` as any;
  const [{ n: ingested }] = await sql`select count(distinct dataset_id)::int n from individuals` as any;
  const fmt = (n: number) => n.toLocaleString("en-US");

  const groupBy = (keyFn: (e: CatalogEntry) => string) => {
    const m = new Map<string, { datasets: number; records: number }>();
    for (const e of entries) {
      const k = keyFn(e);
      const c = m.get(k) ?? { datasets: 0, records: 0 };
      c.datasets++; c.records += e.records; m.set(k, c);
    }
    return [...m.entries()].sort((a, b) => b[1].records - a[1].records);
  };
  const byLicense = (lic: License) => entries.filter((e) => e.license === lic);
  const sumRecords = (es: CatalogEntry[]) => es.reduce((s, e) => s + e.records, 0);
  const byTelemetry = groupBy((e) => e.telemetry);
  const byTaxon = groupBy((e) => e.taxon);
  const byPublisher = groupBy((e) => e.publisher ?? "(unknown)");

  // Migration-relevant subset: GPS/Argos tracking of bird/mammal/reptile.
  const migration = entries.filter((e) =>
    (e.telemetry === "gps/argos" || e.telemetry === "gps/other") &&
    ["bird", "mammal", "reptile"].includes(e.taxon));

  const topDatasets = [...entries].sort((a, b) => b.records - a.records).slice(0, 25);
  const topMigration = [...migration].sort((a, b) => b.records - a.records).slice(0, 20);

  const md = `# GBIF telemetry catalog (open data inventory)

Generated by \`pnpm catalog-gbif\`. Enumerates every CC0 / CC-BY dataset on GBIF
carrying machine-observation (telemetry) records — the reachable universe of
openly-licensed animal-tracking data — **without** ingesting track points.
Taxon groups are derived from each dataset's dominant species' GBIF class.

> **Caveat:** \`MACHINE_OBSERVATION\` also includes acoustic receivers and camera
> traps. Telemetry type below separates GPS/Argos tracking (map-drawable
> migration) from acoustic / imaging. Record counts are machine-observation
> records, not GPS fixes specifically.

## Headline

| | CC0 | CC-BY | Total |
| --- | ---: | ---: | ---: |
| Datasets | ${fmt(byLicense("CC0_1_0").length)} | ${fmt(byLicense("CC_BY_4_0").length)} | ${fmt(entries.length)} |
| Records | ${fmt(sumRecords(byLicense("CC0_1_0")))} | ${fmt(sumRecords(byLicense("CC_BY_4_0")))} | ${fmt(sumRecords(entries))} |
| Species (distinct) | ${fmt(speciesPerLicense["CC0_1_0"] ?? 0)}${(speciesPerLicense["CC0_1_0"] ?? 0) >= 1500 ? "+" : ""} | ${fmt(speciesPerLicense["CC_BY_4_0"] ?? 0)}${(speciesPerLicense["CC_BY_4_0"] ?? 0) >= 1500 ? "+" : ""} | — |

- **${fmt(totalDatasets)}** dataset rows in the DB; **${fmt(ingested)}** have track points ingested.
- **🎯 Migration-relevant subset (GPS bird/mammal/reptile): ${fmt(migration.length)} datasets · ${fmt(sumRecords(migration))} records.** This is the story-candidate index.

## By telemetry type

| Telemetry type | Datasets | Records |
| --- | ---: | ---: |
${byTelemetry.map(([k, v]) => `| ${k} | ${fmt(v.datasets)} | ${fmt(v.records)} |`).join("\n")}

## By taxon group (from GBIF species class)

| Taxon group | Datasets | Records |
| --- | ---: | ---: |
${byTaxon.map(([k, v]) => `| ${k} | ${fmt(v.datasets)} | ${fmt(v.records)} |`).join("\n")}

## Top 20 migration datasets (GPS bird/mammal/reptile)

| Records | License | Species | Dataset | Publisher |
| ---: | --- | --- | --- | --- |
${topMigration.map((d) => `| ${fmt(d.records)} | ${d.license === "CC0_1_0" ? "CC0" : "CC-BY"} | ${(d.species[0] ?? "").slice(0, 28)} | ${d.title.slice(0, 45).replace(/\|/g, "/")} | ${(d.publisher ?? "").slice(0, 28).replace(/\|/g, "/")} |`).join("\n")}

## Top 25 datasets overall (incl. acoustic/imaging)

| Records | Type | Taxon | Dataset | Publisher |
| ---: | --- | --- | --- | --- |
${topDatasets.map((d) => `| ${fmt(d.records)} | ${d.telemetry} | ${d.taxon} | ${d.title.slice(0, 42).replace(/\|/g, "/")} | ${(d.publisher ?? "").slice(0, 26).replace(/\|/g, "/")} |`).join("\n")}

## Top 20 publishers by record count

| Records | Datasets | Publisher |
| ---: | ---: | --- |
${byPublisher.slice(0, 20).map(([p, v]) => `| ${fmt(v.records)} | ${v.datasets} | ${p.slice(0, 50).replace(/\|/g, "/")} |`).join("\n")}

## What this means for ingestion

- The **migration subset** above is the story-candidate index: pick datasets from
  it to fully ingest (track points) via the authenticated GBIF download API.
- Storage is fine on Neon Launch — full-resolution points for this subset is on
  the order of a few GB.
- Movebank is a complementary source; its per-study license metadata needs a
  (free) Movebank account to read — see RUN_WHEN_READY.md / MOVEBANK_PENDING.md.
`;

  writeFileSync(new URL("../CATALOG.md", import.meta.url), md);
  console.log("✓ Wrote CATALOG.md");
  console.log(`  ${entries.length} datasets · migration subset: ${migration.length} datasets / ${fmt(sumRecords(migration))} records`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
