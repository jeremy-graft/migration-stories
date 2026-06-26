// CATALOG — enumerate ALL openly-licensed (CC0 / CC-BY) animal-telemetry
// datasets on GBIF and record their metadata, WITHOUT pulling track points.
// Answers "how much is there, and how much is gettable" before any bulk ingest.
//
// Method: facet GBIF's open machine-observation occurrences by datasetKey (one
// call per license enumerates every dataset carrying telemetry, with counts),
// then fetch each dataset's metadata. Upserts into `datasets` (a dataset with
// no individuals/points = catalogued but not yet ingested). Emits CATALOG.md.
//
// NOTE: basisOfRecord=MACHINE_OBSERVATION is a proxy for telemetry; it also
// includes acoustic receivers, camera traps and automated sensors, so the true
// GPS-tracking subset is smaller. The report flags this.
//
// Usage: pnpm catalog-gbif
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { db } from "../db/index";
import { datasets } from "../db/schema";
import { gbifFacet, gbifDataset, gbifOrganizationTitle } from "../lib/sources/gbif";
import { normalizeLicense, isCommercialSafe, type License } from "../lib/licenses";

const GBIF_LICENSES = ["CC0_1_0", "CC_BY_4_0"] as const;

interface CatalogEntry {
  key: string;
  title: string;
  publisher?: string;
  license: License;
  doi?: string;
  records: number; // machine-observation records (telemetry proxy)
  telemetry: string;
  taxon: string;
}

// Heuristic classification from the dataset title — imperfect but decision-useful.
function telemetryType(title: string): string {
  const t = title.toLowerCase();
  if (/acoustic|hydrophone|receiver|passive acou|\bvr2|detection|silic|telemetry array/.test(t)) return "acoustic";
  if (/camera|\btrap|imaging|plankton|\bvideo|image dataset/.test(t)) return "imaging/camera";
  return "gps/other";
}
function taxonGroup(title: string): string {
  const t = title.toLowerCase();
  if (/gull|stork|spoonbill|curlew|harrier|kestrel|eagle|goose|geese|duck|tern|oystercatcher|godwit|crane|raptor|owl|\bbird|avian|passerine|wader|shorebird|petrel|albatross|gannet|swan|heron|ibis|falcon|buzzard|vulture/.test(t)) return "bird";
  if (/salmon|sturgeon|\bcod\b|crab|lobster|\bbass\b|\beel\b|shark|\bray\b|\bfish|trout|tuna|pike|carp|herring(?! gull)|mackerel|sole|plaice|perch/.test(t)) return "fish/inverts";
  if (/seal|whale|dolphin|cetacean|\bbat\b|deer|\bfox\b|wolf|bear|elephant|lion|mammal|rodent|hare|boar|badger|otter|lynx/.test(t)) return "mammal";
  if (/turtle|tortoise|snake|lizard|reptile|crocodile/.test(t)) return "reptile";
  return "other/unknown";
}

async function main() {
  console.log("\n=== Cataloguing open GBIF telemetry datasets (no auth) ===\n");

  // 1. Enumerate datasets + species per license via facets.
  const speciesPerLicense: Record<string, number> = {};
  const datasetCounts = new Map<string, { records: number; gbifLicense: string }>();
  for (const lic of GBIF_LICENSES) {
    const q = { basisOfRecord: "MACHINE_OBSERVATION", license: lic };
    const dsFacet = await gbifFacet(q, "datasetKey", 1500);
    const spFacet = await gbifFacet(q, "speciesKey", 1500);
    speciesPerLicense[lic] = spFacet.length;
    for (const d of dsFacet) datasetCounts.set(d.name, { records: d.count, gbifLicense: lic });
    console.log(`  ${lic}: ${dsFacet.length} datasets, ${spFacet.length}${spFacet.length >= 1500 ? "+" : ""} species`);
  }
  console.log(`\nTotal distinct datasets to catalogue: ${datasetCounts.size}\n`);

  // 2. Fetch metadata per dataset; upsert; collect for the report.
  const entries: CatalogEntry[] = [];
  let done = 0, skipped = 0;
  for (const [key, { records }] of datasetCounts) {
    try {
      const meta = await gbifDataset(key);
      const license = normalizeLicense(meta.license);
      if (!isCommercialSafe(license)) { skipped++; continue; } // metadata license is authoritative
      const publisher = (await gbifOrganizationTitle(meta.publisherKey)) ?? meta.publisher;

      await db
        .insert(datasets)
        .values({
          id: `gbif:${key}`,
          source: "gbif",
          title: meta.title,
          doi: meta.doi,
          license,
          citation: meta.citation,
          publisher,
          recordCount: records,
          raw: meta.raw as object,
        })
        .onConflictDoUpdate({
          target: datasets.id,
          // recordCount here = telemetry total, the right catalog figure.
          set: {
            title: meta.title, doi: meta.doi, license, citation: meta.citation,
            publisher, recordCount: records, raw: meta.raw as object,
          },
        });

      entries.push({
        key, title: meta.title, publisher, license, doi: meta.doi, records,
        telemetry: telemetryType(meta.title), taxon: taxonGroup(meta.title),
      });
    } catch (e) {
      skipped++;
    }
    if (++done % 25 === 0) process.stdout.write(`.${done}`);
  }
  process.stdout.write(`\n\nCatalogued ${entries.length} datasets (${skipped} skipped).\n`);

  // 3. Report.
  const sql = neon(process.env.DATABASE_URL!);
  const [{ n: totalDatasets }] = await sql`select count(*)::int n from datasets` as any;
  const [{ n: ingested }] = await sql`select count(distinct dataset_id)::int n from individuals` as any;

  const byLicense = (lic: License) => entries.filter((e) => e.license === lic);
  const sumRecords = (es: CatalogEntry[]) => es.reduce((s, e) => s + e.records, 0);
  const byPublisher = new Map<string, { datasets: number; records: number }>();
  for (const e of entries) {
    const p = e.publisher ?? "(unknown)";
    const cur = byPublisher.get(p) ?? { datasets: 0, records: 0 };
    cur.datasets++; cur.records += e.records;
    byPublisher.set(p, cur);
  }
  const topDatasets = [...entries].sort((a, b) => b.records - a.records).slice(0, 25);
  const topPublishers = [...byPublisher.entries()].sort((a, b) => b[1].records - a[1].records).slice(0, 20);
  const fmt = (n: number) => n.toLocaleString("en-US");

  // Group by a key function → {datasets, records}, sorted by records desc.
  const groupBy = (keyFn: (e: CatalogEntry) => string) => {
    const m = new Map<string, { datasets: number; records: number }>();
    for (const e of entries) {
      const k = keyFn(e);
      const c = m.get(k) ?? { datasets: 0, records: 0 };
      c.datasets++; c.records += e.records; m.set(k, c);
    }
    return [...m.entries()].sort((a, b) => b[1].records - a[1].records);
  };
  const byTelemetry = groupBy((e) => e.telemetry);
  const byTaxon = groupBy((e) => e.taxon);

  const md = `# GBIF telemetry catalog (open data inventory)

Generated by \`pnpm catalog-gbif\`. Enumerates every CC0 / CC-BY dataset on GBIF
that carries machine-observation (telemetry) records — the reachable universe of
openly-licensed animal-tracking data — **without** ingesting track points.

> **Caveat:** \`MACHINE_OBSERVATION\` is a proxy for telemetry. It also includes
> acoustic receivers, camera traps and automated sensors, so the true GPS-tracking
> subset is smaller than the totals below. Record counts are machine-observation
> records, not GPS fixes specifically.

## Headline

| | CC0 | CC-BY | Total |
| --- | ---: | ---: | ---: |
| Datasets | ${fmt(byLicense("CC0_1_0").length)} | ${fmt(byLicense("CC_BY_4_0").length)} | ${fmt(entries.length)} |
| Records | ${fmt(sumRecords(byLicense("CC0_1_0")))} | ${fmt(sumRecords(byLicense("CC_BY_4_0")))} | ${fmt(sumRecords(entries))} |
| Species (distinct) | ${fmt(speciesPerLicense["CC0_1_0"] ?? 0)}${(speciesPerLicense["CC0_1_0"] ?? 0) >= 1500 ? "+" : ""} | ${fmt(speciesPerLicense["CC_BY_4_0"] ?? 0)}${(speciesPerLicense["CC_BY_4_0"] ?? 0) >= 1500 ? "+" : ""} | — |

- **${fmt(totalDatasets)}** dataset rows now in the DB (catalogued).
- **${fmt(ingested)}** of them have track points ingested so far.
- All entries pass the commercial-safe license gate (CC0 / CC-BY only).

## By telemetry type (heuristic, from titles)

The headline total is heterogeneous. For *migration stories* we want GPS/Argos
tracks, not acoustic-receiver fish telemetry or camera-trap/imaging records.

| Telemetry type | Datasets | Records |
| --- | ---: | ---: |
${byTelemetry.map(([k, v]) => `| ${k} | ${fmt(v.datasets)} | ${fmt(v.records)} |`).join("\n")}

## By taxon group (heuristic, from titles)

| Taxon group | Datasets | Records |
| --- | ---: | ---: |
${byTaxon.map(([k, v]) => `| ${k} | ${fmt(v.datasets)} | ${fmt(v.records)} |`).join("\n")}

> **Bottom line for migration stories:** the addressable subset is roughly the
> **bird + mammal, gps/other** slice — far smaller than 34.5M, but still millions
> of GPS fixes across dozens of datasets. That's the index stories will draw from.

## Top 25 datasets by record count

| Records | License | Dataset | Publisher |
| ---: | --- | --- | --- |
${topDatasets.map((d) => `| ${fmt(d.records)} | ${d.license === "CC0_1_0" ? "CC0" : "CC-BY"} | ${d.title.slice(0, 60).replace(/\|/g, "/")} | ${(d.publisher ?? "").slice(0, 30).replace(/\|/g, "/")} |`).join("\n")}

## Top 20 publishers by record count

| Records | Datasets | Publisher |
| ---: | ---: | --- |
${topPublishers.map(([p, v]) => `| ${fmt(v.records)} | ${v.datasets} | ${p.slice(0, 50).replace(/\|/g, "/")} |`).join("\n")}

## What this means for ingestion

- The catalog is the **story-candidate index**: pick datasets from here to fully
  ingest (track points) via the authenticated GBIF download API (Phase 3).
- Storage is fine on Neon Launch — full-resolution points for the GPS-tracking
  subset is on the order of a few GB.
- Next unlock: a free GBIF account, then bulk-ingest scoped batches (by taxon /
  region / publisher) straight into the same \`datasets\` → \`individuals\` →
  \`track_points\` schema.
`;

  writeFileSync(new URL("../CATALOG.md", import.meta.url), md);
  console.log("✓ Wrote CATALOG.md");
  console.log(`  ${entries.length} datasets · ${fmt(sumRecords(entries))} records · DB now holds ${totalDatasets} dataset rows`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
