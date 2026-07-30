// Species-level range-shift layer — the "decades of change" data.
// Ingests BioShifts (Lenoir et al. 2020, figshare 7413365, CC BY 4.0): a global
// geodatabase of 30k+ measured climate-driven range shifts. Each row = one
// species' range edge moved at rate R (km/year or m/year) over a period.
//
// We keep these as a reference table (species_shifts) and join to our tracked
// individuals by scientific_name: "this species is documented shifting poleward
// at X km/decade — and here is one tracked animal that made the journey."
//
// Usage: pnpm tsx scripts/ingest-shifts.ts          # download + ingest + report
//        pnpm tsx scripts/ingest-shifts.ts report   # just the join report
import "dotenv/config";
import unzipper from "unzipper";
import { client, db, sql } from "../db/index";
import { speciesShifts } from "../db/schema";

const FIGSHARE_ARTICLE = "7413365"; // BioShifts v1

// --- minimal RFC4180 CSV parser (BioShifts.csv is comma-delimited) ----------
function parseCsv(text: string): string[][] {
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

async function ensureTable() {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS species_shifts (
      id bigserial PRIMARY KEY,
      scientific_name text NOT NULL,
      class text,
      gradient text,
      position text,
      shift_rate double precision,
      unit text,
      ecosystem text,
      hemisphere text,
      start_year integer,
      quality text,
      source text,
      reference text
    );
    CREATE INDEX IF NOT EXISTS species_shifts_name_idx ON species_shifts (scientific_name);
  `);
}

async function downloadBioShiftsCsv(): Promise<string[][]> {
  const art = await (await fetch(`https://api.figshare.com/v2/articles/${FIGSHARE_ARTICLE}`, { signal: AbortSignal.timeout(60000) })).json();
  const f = (art.files ?? []).find((x: any) => /BioShifts\.zip/i.test(x.name));
  if (!f) throw new Error("BioShifts.zip not found on figshare article");
  console.log(`Downloading ${f.name} (${Math.round(f.size / 1024)} KB, ${art.license?.name})…`);
  const buf = Buffer.from(await (await fetch(f.download_url, { signal: AbortSignal.timeout(180000) })).arrayBuffer());
  const dir = await unzipper.Open.buffer(buf);
  const entry = dir.files.find((x) => /BioShifts\.csv$/i.test(x.path));
  if (!entry) throw new Error("BioShifts.csv not found in zip");
  const content = (await entry.buffer()).toString("utf8");
  return parseCsv(content);
}

async function ingest() {
  await ensureTable();
  const rows = await downloadBioShiftsCsv();
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const c = {
    species: idx("Species"), cls: idx("Class"), hemi: idx("Hemisphere"),
    eco: idx("Ecosystem"), grad: idx("Gradient"), pos: idx("Position"),
    rate: idx("ShiftR"), unit: idx("Unit"), qual: idx("Quality"),
    start: idx("Start"), ref: idx("Reference"),
  };
  if (c.species < 0 || c.rate < 0) throw new Error(`unexpected BioShifts columns: ${header.join(",")}`);

  // fresh load: clear any prior bioshifts rows so re-runs are idempotent
  await sql`delete from species_shifts where source = 'bioshifts'`;

  const records: typeof speciesShifts.$inferInsert[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[c.species] || "").trim().replace(/_/g, " ");
    if (!name || !/[A-Za-z]/.test(name)) continue;
    const rate = Number(r[c.rate]);
    const start = parseInt(r[c.start], 10);
    records.push({
      scientificName: name,
      taxClass: c.cls >= 0 ? r[c.cls] || null : null,
      gradient: c.grad >= 0 ? r[c.grad] || null : null,
      position: c.pos >= 0 ? r[c.pos] || null : null,
      shiftRate: Number.isFinite(rate) ? rate : null,
      unit: c.unit >= 0 ? r[c.unit] || null : null,
      ecosystem: c.eco >= 0 ? r[c.eco] || null : null,
      hemisphere: c.hemi >= 0 ? r[c.hemi] || null : null,
      startYear: Number.isFinite(start) ? start : null,
      quality: c.qual >= 0 ? r[c.qual] || null : null,
      source: "bioshifts",
      reference: c.ref >= 0 ? r[c.ref] || null : null,
    });
  }

  const BATCH = 2000; // 13 cols × 2000 = 26k params, under the 65535 cap
  for (let i = 0; i < records.length; i += BATCH) {
    await db.insert(speciesShifts).values(records.slice(i, i + BATCH));
    process.stdout.write(".");
  }
  console.log(`\n✓ Ingested ${records.length.toLocaleString()} range-shift records from BioShifts.`);
}

// Join the shift table to the species we actually track → the story candidates,
// with a CLEAN directional signal (per-species median latitudinal velocity, the
// fraction of estimates that agree on direction, and the richest track we hold).
async function report() {
  const [{ n }] = (await sql`select count(*)::int n from species_shifts`) as any[];
  console.log(`\nspecies_shifts rows: ${Number(n).toLocaleString()}`);

  // --- 1. VALIDATE the sign convention against BioShifts' headline finding -----
  // Lenoir et al. 2020: marine species track warming poleward much faster than
  // terrestrial. If positive ShiftR = poleward, marine median ≫ terrestrial median
  // and both are positive. (Prints so we can sanity-check, not just assume.)
  const eco = (await sql`
    select ecosystem,
           count(*)::int n,
           round(percentile_cont(0.5) within group (order by shift_rate)::numeric, 2) median_kmyr
    from species_shifts
    where gradient = 'Latitudinal' and unit = 'km/year' and shift_rate is not null
    group by ecosystem order by median_kmyr desc
  `) as any[];
  console.log(`\nSign-convention check (latitudinal median km/yr by ecosystem — expect marine ≫ terrestrial, both +):`);
  for (const e of eco) console.log(`  ${String(e.ecosystem).padEnd(12)} median ${e.median_kmyr} km/yr  (n=${e.n})`);

  // --- 2. Per-species directional signal for the species we track --------------
  // median latitudinal velocity (km/yr, + = poleward); agreement = share of
  // estimates with the same sign as the median; richest track we hold.
  const rows = (await sql`
    with lat as (
      select scientific_name, shift_rate, ecosystem
      from species_shifts
      where gradient = 'Latitudinal' and unit = 'km/year' and shift_rate is not null
    ),
    agg as (
      select scientific_name,
             count(*)::int n,
             percentile_cont(0.5) within group (order by shift_rate) med,
             max(ecosystem) ecosystem
      from lat group by scientific_name
    ),
    tracked as (
      select scientific_name,
             count(distinct id)::int inds,
             max(coalesce(point_count,0))::int max_pts
      from individuals where scientific_name is not null group by scientific_name
    )
    select a.scientific_name, a.n, a.ecosystem, t.inds, t.max_pts,
           round(a.med::numeric, 2) km_yr,
           ( select round((count(*) filter (where sign(l.shift_rate) = sign(a.med)))::numeric
                          / nullif(count(*),0), 2)
             from lat l where l.scientific_name = a.scientific_name ) agree
    from agg a
    join tracked t on lower(t.scientific_name) = lower(a.scientific_name)
    order by a.med desc
  `) as any[];

  const fmt = (r: any, arrow: string) =>
    `  ${arrow} ${String(r.scientific_name).padEnd(30)} ${String(r.km_yr).padStart(6)} km/yr ` +
    `(${(Number(r.km_yr) * 10).toFixed(0).padStart(4)}/decade)  agree ${Number(r.agree).toFixed(2)}  ` +
    `n=${String(r.n).padStart(2)}  track:${String(r.max_pts).padStart(5)}pts`;

  const STRONG = 0.5;  // km/yr threshold for "clearly directional"
  const ROBUST = 3;    // min independent estimates to trust the direction/rate
  const poleward = rows.filter((r) => Number(r.km_yr) >= STRONG);
  const equatorward = rows.filter((r) => Number(r.km_yr) <= -STRONG);
  const stable = rows.filter((r) => Math.abs(Number(r.km_yr)) < STRONG);

  console.log(`\nTracked species with a clean LATITUDINAL signal: ${rows.length}  ` +
    `(poleward ${poleward.length} · equatorward ${equatorward.length} · ~stable ${stable.length})`);

  // Best story candidates = ROBUST (≥3 estimates), agreeing, with a real track.
  // Single-estimate species (n=1) are excluded — their extreme rates are noise.
  const candidates = poleward
    .filter((r) => Number(r.n) >= ROBUST && Number(r.agree) >= 0.6 && Number(r.max_pts) >= 50)
    .sort((a, b) => (Number(b.km_yr) * Number(b.agree)) - (Number(a.km_yr) * Number(a.agree)));
  console.log(`\n★ Robust POLEWARD story candidates (n≥${ROBUST}, agree ≥0.6, track ≥50 pts) — ${candidates.length}:`);
  candidates.forEach((r) => console.log(fmt(r, "↑")));

  const retreating = equatorward.filter((r) => Number(r.n) >= ROBUST && Number(r.agree) >= 0.6 && Number(r.max_pts) >= 50);
  console.log(`\n↓ Robust EQUATORWARD / retreating species we track — ${retreating.length}:`);
  retreating.forEach((r) => console.log(fmt(r, "↓")));

  // exploratory: strong direction but only a single published estimate (use with care)
  const single = poleward.filter((r) => Number(r.n) === 1 && Number(r.max_pts) >= 200).slice(0, 6);
  if (single.length) {
    console.log(`\n(exploratory — single-estimate, treat rate as indicative only:)`);
    single.forEach((r) => console.log(fmt(r, "·")));
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "report") { await report(); }
  else { await ingest(); await report(); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
