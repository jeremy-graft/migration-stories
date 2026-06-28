// PHASE 4 — Movebank ingestion (CC0 / CC-BY studies). Reads the once-fetched
// study-list CSV, catalogs the open GPS studies, then ingests them new-species
// first. POLITE BY DESIGN: strictly sequential, delays between studies, and
// server-side daily reduction (event_reduction_profile) so we download a small
// fraction instead of hundreds of millions of raw fixes. Handshake in
// lib/sources/movebank.ts. Respect Movebank's one-request-per-IP rule.
//
// Usage: pnpm tsx scripts/ingest-movebank.ts <study-list.csv> [limit]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { db } from "../db/index";
import { datasets } from "../db/schema";
import { movebankRead } from "../lib/sources/movebank";
import { ingestTracks, type IndividualInput } from "../lib/ingest";
import { normalizeLicense, isCommercialSafe } from "../lib/licenses";
import type { RawPoint } from "../lib/track";

const DELAY_MS = 3000;
const REDUCTION = "EURING_01"; // Movebank server-side daily reduction profile

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

interface Study { id: string; name: string; license: string; taxa: string[]; locs: number }

function loadOpenGpsStudies(path: string): Study[] {
  const rows = parseCSV(readFileSync(path, "utf8"));
  const h = rows[0]; const ci = (n: string) => h.indexOf(n);
  const out: Study[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < h.length) continue;
    const lic = r[ci("license_type")];
    if (lic !== "CC_0" && lic !== "CC_BY") continue;
    if (Number(r[ci("number_of_deployed_locations")] || 0) <= 0) continue;
    if (!/gps|argos/i.test(r[ci("sensor_type_ids")] || "")) continue;
    out.push({
      id: r[ci("id")], name: r[ci("name")], license: lic,
      taxa: (r[ci("taxon_ids")] || "").split(",").map((s) => s.trim()).filter(Boolean),
      locs: Number(r[ci("number_of_deployed_locations")] || 0),
    });
  }
  return out;
}

/** Read a study's (reduced) events incl. per-record species, via the handshake.
 *  Retries transient network failures (a flaky connection drops fetches). */
async function readEvents(studyId: string) {
  const params = {
    entity_type: "event", study_id: studyId,
    attributes: "timestamp,location_long,location_lat,individual_local_identifier,individual_taxon_canonical_name",
    event_reduction_profile: REDUCTION,
  };
  let csv = "";
  for (let attempt = 0; ; attempt++) {
    try { csv = await movebankRead(params); break; }
    catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  const rows = parseCSV(csv);
  if (rows.length < 2) return new Map<string, { taxon?: string; points: RawPoint[] }>();
  const h = rows[0]; const ci = (n: string) => h.indexOf(n);
  const cTs = ci("timestamp"), cLon = ci("location_long"), cLat = ci("location_lat"),
    cInd = ci("individual_local_identifier"), cTax = ci("individual_taxon_canonical_name");
  const byInd = new Map<string, { taxon?: string; points: RawPoint[] }>();
  for (const r of rows.slice(1)) {
    const id = (r[cInd] ?? "").trim();
    if (!id) continue;
    let e = byInd.get(id);
    if (!e) { e = { taxon: cTax >= 0 ? r[cTax]?.trim() : undefined, points: [] }; byInd.set(id, e); }
    e.points.push({ ts: r[cTs], lon: Number(r[cLon]), lat: Number(r[cLat]) });
  }
  return byInd;
}

async function main() {
  const path = process.argv[2]!;
  const limit = Number(process.argv[3] || 5);
  const studies = loadOpenGpsStudies(path);
  console.log(`Open GPS studies (CC0/CC-BY): ${studies.length}`);

  // Catalog all open studies into `datasets` (license-gated).
  for (const s of studies) {
    const license = normalizeLicense(s.license);
    if (!isCommercialSafe(license)) continue;
    await db.insert(datasets).values({
      id: `movebank:${s.id}`, source: "movebank_repo", title: s.name || `Movebank study ${s.id}`,
      license, taxa: s.taxa, recordCount: s.locs, citation: `Movebank study ${s.id}`, publisher: "Movebank",
    }).onConflictDoUpdate({
      target: datasets.id,
      set: { title: s.name || `Movebank study ${s.id}`, license, taxa: s.taxa, recordCount: s.locs },
    });
  }
  console.log(`Catalogued ${studies.length} open Movebank studies.\n`);

  // Select new-species-first, skipping already-attempted.
  const sql = neon(process.env.DATABASE_URL!);
  const have = new Set((await sql`select distinct scientific_name s from individuals where scientific_name is not null` as any).map((r: any) => r.s.toLowerCase()));
  const attempted = new Set((await sql`select id from datasets where source = 'movebank_repo' and ingest_attempted_at is not null` as any).map((r: any) => r.id));
  const picks = studies
    .filter((s) => !attempted.has(`movebank:${s.id}`))
    .map((s) => ({ s, newSp: s.taxa.filter((t) => !have.has(t.toLowerCase())).length }))
    .filter((x) => x.newSp > 0)
    .sort((a, b) => b.newSp - a.newSp || a.s.locs - b.s.locs)
    .slice(0, limit);

  console.log(`Ingesting ${picks.length} studies (new-species-first, ${DELAY_MS}ms apart)…\n`);
  let gInd = 0, gPts = 0, consecutiveFails = 0;
  for (const { s, newSp } of picks) {
    process.stdout.write(`  study ${s.id} "${(s.name || "").slice(0, 38)}" (${newSp} new sp) `);
    try {
      const byInd = await readEvents(s.id);
      const inds: IndividualInput[] = [...byInd.entries()].map(([id, v]) => ({
        sourceIndividualId: id, name: id, scientificName: v.taxon || (s.taxa.length === 1 ? s.taxa[0] : undefined),
        points: v.points, raw: { studyId: s.id },
      }));
      const summary = await ingestTracks({
        id: `movebank:${s.id}`, source: "movebank_repo", title: s.name || `Movebank study ${s.id}`,
        license: normalizeLicense(s.license), citation: `Movebank study ${s.id}`, publisher: "Movebank", raw: { studyId: s.id },
      }, inds);
      await sql`update datasets set ingest_attempted_at = now() where id = ${`movebank:${s.id}`}`;
      gInd += summary.individualsWritten; gPts += summary.pointsWritten;
      consecutiveFails = 0;
      process.stdout.write(`→ +${summary.individualsWritten} ind, +${summary.pointsWritten} pts (${summary.skipped} skip)\n`);
    } catch (e) {
      process.stdout.write(`✗ ${(e as Error).message}\n`);
      if (++consecutiveFails >= 5) {
        console.log("\n⚠ Aborting — 5 consecutive failures (possible rate-limit / block). Re-run later to resume; succeeded studies are marked and skipped.");
        break;
      }
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`\n✓ Movebank ingest: +${gInd} individuals · +${gPts} points`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
