// LENS 2 — Phenology drift. Is spring migration happening EARLIER across the
// 2000–2024 span? Timing is far more robust than mean-position (which the naive
// spatial approach proved is dominated by deployment bias): for each animal-year
// we find the day-of-year of its strongest NORTHWARD push, then per species
// regress that timing against year. Negative slope = springs getting earlier.
import "dotenv/config";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const hav = (la1: number, lo1: number, la2: number, lo2: number) => {
  const d = Math.PI / 180, r = 6371;
  const a = Math.sin((la2 - la1) * d / 2) ** 2 + Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin((lo2 - lo1) * d / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
};
function splitCsv(l: string) { const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o; }
const parseTs = (s: string) => Date.parse(s.slice(0, 19).replace(" ", "T") + "Z");
const doyOf = (t: number) => { const d = new Date(t); return Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000); };
import { BAD_SPECIES as BAD } from "../lib/bad-species";

// least-squares slope of y vs x
function slope(xs: number[], ys: number[]) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

async function main() {
  const sciOf = new Map<string, string>();
  const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n");
  for (let i = 1; i < inds.length; i++) { if (!inds[i]) continue; const c = splitCsv(inds[i]); if (c[4]) sciOf.set(c[0], c[4]); }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));

  const byInd = new Map<string, number[]>();
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t") continue;
    const id = +c[0]; if (outliers.has(id)) continue;
    const la = +c[4], lo = +c[3], t = parseTs(c[2]);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(t)) continue;
    (byInd.get(c[1]) ?? byInd.set(c[1], []).get(c[1])!).push(t, la, lo);
  }

  // (species, year) → list of spring-push day-of-year
  const obs = new Map<string, Map<number, number[]>>();
  for (const [indId, flat] of byInd) {
    const sci = sciOf.get(indId); if (!sci || BAD.has(sci)) continue;
    const n = flat.length / 3;
    const P = Array.from({ length: n }, (_, i) => ({ t: flat[i * 3], la: flat[i * 3 + 1], lo: flat[i * 3 + 2] }))
      .sort((a, b) => a.t - b.t);
    if (P.reduce((s, p) => s + p.la, 0) / P.length <= 0) continue;   // northern hemisphere only
    // split by calendar year
    const years = new Map<number, typeof P>();
    for (const p of P) { const y = new Date(p.t).getUTCFullYear(); (years.get(y) ?? years.set(y, []).get(y)!).push(p); }
    for (const [year, all] of years) {
      // ROBUST metric: the "migration midpoint date" — the day the animal first
      // crosses the halfway point of its own spring latitude range heading north.
      // Far stabler than a single max-rate day (which sampling noise dominates).
      const pts = all.filter((p) => { const d = doyOf(p.t); return d >= 32 && d <= 212; }); // Feb–Jul
      if (pts.length < 10) continue;
      const las = pts.map((p) => p.la);
      const loLat = Math.min(...las), hiLat = Math.max(...las);
      if (hiLat - loLat < 3) continue;                                 // must actually migrate
      const mid = (loLat + hiLat) / 2;
      let doy = -1;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i - 1].la < mid && pts[i].la >= mid) { doy = doyOf(pts[i].t); break; }
      }
      if (doy > 0) {
        const m = obs.get(sci) ?? obs.set(sci, new Map()).get(sci)!;
        (m.get(year) ?? m.set(year, []).get(year)!).push(doy);
      }
    }
  }

  // per species: median doy per year → regress vs year
  const rows: { sci: string; slope: number; yrs: number; obs: number; first: number; last: number }[] = [];
  const globalByYear = new Map<number, number[]>();
  for (const [sci, m] of obs) {
    const xs: number[] = [], ys: number[] = [];
    let cnt = 0;
    for (const [y, ds] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
      if (ds.length < 3) continue;                       // ≥3 animals that year
      xs.push(y); ys.push(median(ds)); cnt += ds.length;
      (globalByYear.get(y) ?? globalByYear.set(y, []).get(y)!).push(...ds);
    }
    // ≥10 years AND a ≥12-year span — short noisy windows produce absurd slopes
    if (xs.length >= 10 && xs[xs.length - 1] - xs[0] >= 12)
      rows.push({ sci, slope: slope(xs, ys), yrs: xs.length, obs: cnt, first: xs[0], last: xs[xs.length - 1] });
  }

  console.log(`\nLENS 2 — PHENOLOGY DRIFT (spring northward push, N-hemisphere)`);
  console.log(`Species with ≥10 yrs & ≥12-yr span: ${rows.length}\n`);
  const fmt = (r: any) => `  ${r.slope < 0 ? "⏪" : "⏩"} ${r.sci.padEnd(26)} ${(r.slope * 10).toFixed(1).padStart(6)} days/decade  (${r.yrs} yrs ${r.first}–${r.last}, ${r.obs} animal-yrs)`;
  rows.sort((a, b) => a.slope - b.slope);
  console.log("⏪ Migrating EARLIER (strongest):");
  rows.slice(0, 10).forEach((r) => console.log(fmt(r)));
  console.log("\n⏩ Migrating LATER (strongest):");
  rows.slice(-8).reverse().forEach((r) => console.log(fmt(r)));

  const earlier = rows.filter((r) => r.slope < 0).length;
  console.log(`\nBalance: ${earlier} species shifting earlier vs ${rows.length - earlier} later ` +
    `(chance would be ~${Math.round(rows.length / 2)}/${Math.round(rows.length / 2)})`);
  const gx: number[] = [], gy: number[] = [];
  for (const [y, ds] of [...globalByYear.entries()].sort((a, b) => a[0] - b[0])) if (ds.length >= 20) { gx.push(y); gy.push(median(ds)); }
  if (gx.length >= 6) console.log(`Corpus-wide spring timing trend: ${(slope(gx, gy) * 10).toFixed(1)} days/decade (${gx.length} yrs, median-of-all)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
