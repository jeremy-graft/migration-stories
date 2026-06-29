// One-time migration: copy the existing Neon database into the local PGlite
// store. Applies the schema (drizzle migrations) to PGlite, then streams every
// table down from Neon. track_points is keyset-batched; the bigserial sequence
// is reset afterwards so future inserts don't collide.
//
// Usage: pnpm tsx scripts/migrate-to-local.ts
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, client } from "../db/index";
import { datasets, individuals, trackPoints, stories } from "../db/schema";

const neonSql = neon(process.env.DATABASE_URL!);
const D = (v: any) => (v ? new Date(v) : null); // ISO string -> Date (drizzle timestamp mode)

async function insertBatched(table: any, rows: any[]) {
  if (!rows.length) return;
  // Stay under Postgres's 65535 bind-parameter cap: rows * columns < 65535.
  const cols = Object.keys(rows[0]).length;
  const size = Math.max(1, Math.floor(60000 / cols));
  for (let i = 0; i < rows.length; i += size) {
    await db.insert(table).values(rows.slice(i, i + size));
    process.stdout.write(".");
  }
}

const localCount = async (t: string) =>
  Number(((await client.query(`select count(*)::int c from ${t}`)).rows[0] as any).c);

async function main() {
  console.log("Applying schema to PGlite…");
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../db/migrations", import.meta.url)) });

  // Resumable: skip tables already copied (small tables are all-or-nothing here).
  if (await localCount("datasets") === 0) {
    const ds = (await neonSql`select * from datasets`) as any[];
    await insertBatched(datasets, ds.map((r) => ({
      id: r.id, source: r.source, title: r.title, doi: r.doi, license: r.license,
      citation: r.citation, publisher: r.publisher, taxa: r.taxa, bbox: r.bbox,
      recordCount: r.record_count, ingestedAt: D(r.ingested_at), ingestAttemptedAt: D(r.ingest_attempted_at),
      raw: r.raw, telemetryType: r.telemetry_type, taxonGroup: r.taxon_group,
    })));
    console.log(` datasets: ${ds.length}`);
  } else console.log(" datasets: already present, skip");

  if (await localCount("individuals") === 0) {
    const inds = (await neonSql`select * from individuals`) as any[];
    await insertBatched(individuals, inds.map((r) => ({
      id: r.id, datasetId: r.dataset_id, sourceIndividualId: r.source_individual_id, name: r.name,
      scientificName: r.scientific_name, commonName: r.common_name, sex: r.sex, lifeStage: r.life_stage,
      trackStart: D(r.track_start), trackEnd: D(r.track_end), pointCount: r.point_count,
      distanceKm: r.distance_km, bbox: r.bbox, raw: r.raw,
    })));
    console.log(` individuals: ${inds.length}`);
  } else console.log(" individuals: already present, skip");

  if (await localCount("stories") === 0) {
    const st = (await neonSql`select * from stories`) as any[];
    if (st.length) await insertBatched(stories, st.map((r) => ({
      id: r.id, individualId: r.individual_id, slug: r.slug, title: r.title, dek: r.dek,
      beats: r.beats, geojson: r.geojson, status: r.status, createdAt: D(r.created_at),
    })));
    console.log(` stories: ${st.length}`);
  }

  // track_points (bulk, keyset-paginated by id) — resume from local max(id).
  console.log("track_points (keyset-batched, resuming from local max id):");
  let lastId = Number(((await client.query("select coalesce(max(id),0)::int m from track_points")).rows[0] as any).m);
  let total = await localCount("track_points");
  for (;;) {
    const page = (await neonSql`
      select id, individual_id, ts, lon, lat, visible from track_points
      where id > ${lastId} order by id limit 25000`) as any[];
    if (!page.length) break;
    await insertBatched(trackPoints, page.map((r) => ({
      id: r.id, individualId: r.individual_id, ts: D(r.ts), lon: r.lon, lat: r.lat, visible: r.visible,
    })));
    lastId = page[page.length - 1].id;
    total += page.length;
    process.stdout.write(` ${total}\n`);
  }

  // Reset the bigserial sequence so future inserts don't collide with copied ids.
  await client.query(`select setval(pg_get_serial_sequence('track_points','id'), coalesce((select max(id) from track_points),1))`);

  const verify = (await client.query(`select count(*)::int c from track_points`)).rows[0] as any;
  console.log(`\n✓ Migrated. Local PGlite now has ${total} track points (verify: ${verify?.c}).`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
