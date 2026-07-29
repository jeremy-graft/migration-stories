// ★ THERMAL CUE vs CALENDAR CUE — the question this corpus is built to answer.
//
// When a migrant arrives at its breeding grounds, is it reading a THERMOMETER or
// a CALENDAR? Regress each species' arrival date against that year's spring
// temperature (the standard phenology method):
//
//   slope ≈ -X days/°C  → THERMAL-CUED: warm spring ⇒ arrives earlier. It can
//                          track a warming climate.
//   slope ≈ 0           → CALENDAR-CUED: locked to daylight. As springs warm it
//                          arrives after the food peak → PHENOLOGICAL MISMATCH,
//                          the leading mechanism behind migrant declines.
//
// This is a WITHIN-species test (each species vs itself across years), which is
// why it survives the effort bias that destroys this corpus's cross-species
// geographic analyses.
//
// Temperature: real per-year ERA5 (Open-Meteo archive) at each species' own
// arrival region — ONE call per species covers every year. Cached.
//
// Usage: pnpm tsx scripts/analyze-cue.ts
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const CACHE = R("rescue/cue-temps.json");
const WINDOW = 45;                       // days before median arrival = the cue window

function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o;
}
const parseTs = (s: string) => Date.parse(s.slice(0, 19).replace(" ", "T") + "Z");
const doyOf = (t: number) => { const d = new Date(t); return Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000); };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
function fit(xs: number[], ys: number[]) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { slope: sxx ? sxy / sxx : 0, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}

interface Arrival { doy: number; la: number; lo: number }
// The cue must be measured at the BREEDING GROUNDS — that's where spring warmth
// drives the insect/food peak a migrant can mismatch against. Using the arrival
// *crossing* location instead puts the thermometer mid-route (v1 of this script
// sampled the Sinai for white stork and the Sahara for honey buzzard).
const BREED_DOY_LO = 152, BREED_DOY_HI = 213;   // Jun 1 – Jul 31

async function main() {
  // ---- eligible individuals from the canonical table ----
  const sciOf = new Map<string, string>();
  const clean = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
  const H = clean[0].split(","), iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible");
  for (let i = 1; i < clean.length; i++) {
    const c = splitCsv(clean[i]);
    if (c[iElig] !== "t" || !c[iSci]) continue;
    if (BAD_SPECIES.has(c[iSci]) || BAD_INDIVIDUALS.has(c[0])) continue;
    sciOf.set(c[0], c[iSci]);
  }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));

  // ---- group clean points per individual ----
  const byInd = new Map<string, number[]>();
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t" || outliers.has(+c[0]) || !sciOf.has(c[1])) continue;
    const t = parseTs(c[2]), la = +c[4], lo = +c[3];
    if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    (byInd.get(c[1]) ?? byInd.set(c[1], []).get(c[1])!).push(t, la, lo);
  }

  // ---- spring arrival per (species, year) + each species' BREEDING location ----
  const obs = new Map<string, Map<number, Arrival[]>>();
  const breedLa = new Map<string, number[]>(), breedLo = new Map<string, number[]>();
  for (const [indId, flat] of byInd) {
    const sci = sciOf.get(indId)!;
    const n = flat.length / 3;
    const P = Array.from({ length: n }, (_, i) => ({ t: flat[i * 3], la: flat[i * 3 + 1], lo: flat[i * 3 + 2] })).sort((a, b) => a.t - b.t);
    if (P.reduce((s, p) => s + p.la, 0) / P.length <= 0) continue;        // N hemisphere only
    for (const p of P) {                                                   // where does it summer?
      const d = doyOf(p.t);
      if (d >= BREED_DOY_LO && d <= BREED_DOY_HI) {
        (breedLa.get(sci) ?? breedLa.set(sci, []).get(sci)!).push(p.la);
        (breedLo.get(sci) ?? breedLo.set(sci, []).get(sci)!).push(p.lo);
      }
    }
    const years = new Map<number, typeof P>();
    for (const p of P) { const y = new Date(p.t).getUTCFullYear(); (years.get(y) ?? years.set(y, []).get(y)!).push(p); }
    for (const [year, all] of years) {
      const pts = all.filter((p) => { const d = doyOf(p.t); return d >= 32 && d <= 212; });
      if (pts.length < 10) continue;
      const las = pts.map((p) => p.la);
      const lo2 = Math.min(...las), hi = Math.max(...las);
      if (hi - lo2 < 3) continue;                                          // must actually migrate
      const mid = (lo2 + hi) / 2;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i - 1].la < mid && pts[i].la >= mid) {
          const m = obs.get(sci) ?? obs.set(sci, new Map()).get(sci)!;
          (m.get(year) ?? m.set(year, []).get(year)!).push({ doy: doyOf(pts[i].t), la: pts[i].la, lo: pts[i].lo });
          break;
        }
      }
    }
  }

  // ---- species with a long, well-sampled series (same gates as the phenology lens) ----
  const cands: { sci: string; years: number[]; doys: number[]; la: number; lo: number; medDoy: number }[] = [];
  for (const [sci, m] of obs) {
    const years: number[] = [], doys: number[] = [];
    for (const [y, arr] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
      if (arr.length < 3) continue;                                        // ≥3 animals that year
      years.push(y); doys.push(median(arr.map((a) => a.doy)));
    }
    const bla = breedLa.get(sci), blo = breedLo.get(sci);
    if (!bla || bla.length < 50) continue;                                 // need a real summer range
    if (years.length >= 10 && years[years.length - 1] - years[0] >= 12)
      cands.push({ sci, years, doys, la: median(bla), lo: median(blo!), medDoy: Math.round(median(doys)) });
  }
  console.log(`species with ≥10 yrs & ≥12-yr span of spring arrivals: ${cands.length}\n`);

  // ---- real per-year spring temperature at each species' arrival region ----
  const cache: Record<string, Record<string, number[]>> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  for (const c of cands) {
    if (cache[c.sci]) continue;
    const y0 = Math.max(1950, c.years[0]), y1 = c.years[c.years.length - 1];
    // The ERA5 archive lags reality — asking for a future end_date returns NOTHING
    // (which silently dropped the white stork, our best species, whose data runs
    // to the current year). Clamp to a safely-past date.
    const safeEnd = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const end = `${y1}-12-31` < safeEnd ? `${y1}-12-31` : safeEnd;
    const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${c.la.toFixed(3)}&longitude=${c.lo.toFixed(3)}` +
      `&start_date=${y0}-01-01&end_date=${end}&daily=temperature_2m_mean&timezone=UTC`;
    process.stdout.write(`  fetching ERA5 for ${c.sci} @ ${c.la.toFixed(1)},${c.lo.toFixed(1)} … `);
    let ok = false;
    for (let a = 0; a < 6 && !ok; a++) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(120000) });
        if (r.status === 429) { console.log("429, waiting 60s"); await new Promise((s) => setTimeout(s, 60000)); continue; }
        const j = await r.json();
        const times: string[] = j.daily?.time ?? [], temps: number[] = j.daily?.temperature_2m_mean ?? [];
        if (!times.length) { console.log(`EMPTY (${j.reason ?? "no daily data"})`); ok = true; continue; }  // fail loudly, not "ok"
        const byYear: Record<string, number[]> = {};
        for (let i = 0; i < times.length; i++) {
          const yr = times[i].slice(0, 4);
          (byYear[yr] ??= new Array(367).fill(NaN))[doyOf(Date.parse(times[i] + "T00:00:00Z"))] = temps[i];
        }
        cache[c.sci] = byYear; ok = true; console.log("ok");
      } catch (e) { await new Promise((s) => setTimeout(s, 8000)); }
    }
    writeFileSync(CACHE, JSON.stringify(cache));
    await new Promise((s) => setTimeout(s, 12000));            // respect the quota (learned the hard way)
  }

  // ---- the test: arrival date vs that year's spring temperature ----
  const out: any[] = [];
  for (const c of cands) {
    const byYear = cache[c.sci]; if (!byYear) continue;
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < c.years.length; i++) {
      const arr = byYear[String(c.years[i])]; if (!arr) continue;
      const lo = Math.max(1, c.medDoy - WINDOW), hi = c.medDoy;           // fixed window, only the year varies
      const w = arr.slice(lo, hi + 1).filter((v: number) => Number.isFinite(v));
      if (w.length < WINDOW * 0.6) continue;
      xs.push(w.reduce((a, b) => a + b, 0) / w.length); ys.push(c.doys[i]);
    }
    if (xs.length < 8) continue;
    const { slope, r } = fit(xs, ys);
    out.push({ sci: c.sci, slope, r, n: xs.length, dateSD: sd(ys), tempSD: sd(xs), medDoy: c.medDoy, la: c.la, lo: c.lo });
  }

  console.log(`\n=== THERMAL CUE vs CALENDAR CUE (${out.length} species) ===`);
  console.log(`arrival date regressed on the mean temperature of the ${WINDOW} days before arrival\n`);
  out.sort((a, b) => a.slope - b.slope);
  const label = (o: any) => (o.slope < -1 && Math.abs(o.r) > 0.4 ? "🌡️  THERMAL-cued" : Math.abs(o.slope) < 1 || Math.abs(o.r) < 0.3 ? "📅 CALENDAR-locked" : "   mixed");
  for (const o of out) {
    console.log(`  ${label(o)}  ${o.sci.padEnd(26)} ${o.slope.toFixed(1).padStart(6)} days/°C  r=${o.r.toFixed(2).padStart(5)}  ` +
      `(${o.n} yrs · arrival SD ${o.dateSD.toFixed(0)}d · spring-temp SD ${o.tempSD.toFixed(1)}°C)`);
  }
  const thermal = out.filter((o) => o.slope < -1 && Math.abs(o.r) > 0.4).length;
  console.log(`\n  🌡️  thermal-cued (can track warming): ${thermal}`);
  console.log(`  📅 calendar-locked (mismatch risk)  : ${out.filter((o) => Math.abs(o.slope) < 1 || Math.abs(o.r) < 0.3).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
