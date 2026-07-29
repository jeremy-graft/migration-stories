// Creative cross-cutting angles, all from the rescued CSVs (no DB). One streaming
// pass over track_points + a scan of individuals yields several independent lenses
// on the corpus:
//   1. Convergence hotspots — where the planet's tracked species concentrate
//   2. Movement personalities — wanderers vs directed commuters (path/spread)
//   3. Equator-crossers & latitude reach (PERCENTILE-based — min/max is ruined by
//      a single bad fix, e.g. it once had an Arctic ringed seal "crossing the equator")
//   4. The data's own geography — where tracking effort actually sits
//
// NOTE: records (northernmost / longest journey) deliberately live ONLY in
// analyze-motion.ts, which applies the eligibility gates (≥20 clean pts, ≤6yr
// span, ≤300 km/day, named species) and RECOMPUTES distance from clean points.
// The stored distance_km in individuals.csv predates cleaning and is unreliable.
import "dotenv/config";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const hav = (la1: number, lo1: number, la2: number, lo2: number) => {
  const d = Math.PI / 180, r = 6371;
  const a = Math.sin((la2 - la1) * d / 2) ** 2 + Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin((lo2 - lo1) * d / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
};
function splitCsv(line: string): string[] {
  const out: string[] = []; let f = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(f); f = ""; } else f += c; }
  out.push(f); return out;
}

async function main() {
  // skip the known corrupt teleport points (consistent with the other analyses)
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));
  // ---- individuals: id→sci, plus movement personality & journey records ----
  const sciOf = new Map<string, string>();
  const ratios = new Map<string, number[]>();      // species → distance/spread ratios
  const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n");
  for (let i = 1; i < inds.length; i++) {
    if (!inds[i]) continue;
    const c = splitCsv(inds[i]);
    const sci = c[4]; if (!sci || BAD_SPECIES.has(sci)) continue;
    sciOf.set(c[0], sci);
    const pc = +c[10], dist = +c[11];
    const bb = (c[12] || "").replace(/[{}"]/g, "").split(",").map(Number);
    if (pc >= 20 && dist > 0 && bb.length === 4 && bb.every(Number.isFinite)) {
      const spread = hav(bb[1], bb[0], bb[3], bb[2]);
      if (spread > 5) (ratios.get(sci) ?? ratios.set(sci, []).get(sci)!).push(dist / spread);
    }
  }

  // ---- one stream over track_points: hotspots, extremes, lat reach, lat histogram ----
  const cell = new Map<string, Set<string>>();     // 3° grid → distinct species
  const reach = new Map<string, number[]>();       // species → every latitude (for percentiles)
  const latHist = new Array(18).fill(0);           // 10° bands, index 0 = -90..-80
  let total = 0;
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t" || outliers.has(+c[0]) || BAD_INDIVIDUALS.has(c[1])) continue;
    const sci = sciOf.get(c[1]); if (!sci || BAD_SPECIES.has(sci)) continue;
    const lat = +c[4], lon = +c[3];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    total++;
    const k = `${Math.floor(lat / 3)},${Math.floor(lon / 3)}`;
    (cell.get(k) ?? cell.set(k, new Set()).get(k)!).add(sci);
    (reach.get(sci) ?? reach.set(sci, []).get(sci)!).push(lat);
    latHist[Math.min(17, Math.max(0, Math.floor((lat + 90) / 10)))]++;
  }
  console.log(`\nStreamed ${total.toLocaleString()} points.\n`);

  // 1. hotspots
  console.log("🌐 CONVERGENCE HOTSPOTS — 3°×3° cells crossed by the most species:");
  [...cell.entries()].map(([k, s]) => { const [la, lo] = k.split(",").map(Number); return { la: la * 3 + 1.5, lo: lo * 3 + 1.5, n: s.size }; })
    .sort((a, b) => b.n - a.n).slice(0, 12)
    .forEach((h) => console.log(`  ${h.n} species  @ ${h.la.toFixed(0)}°, ${h.lo.toFixed(0)}°  ${nameLoc(h.la, h.lo)}`));

  // 2. personalities
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const pers = [...ratios.entries()].filter(([, a]) => a.length >= 5).map(([sci, a]) => ({ sci, r: med(a), n: a.length }));
  console.log("\n🌀 WANDERERS — most path crammed into their range (foragers/roamers):");
  pers.sort((a, b) => b.r - a.r).slice(0, 8).forEach((p) => console.log(`  ${p.sci.padEnd(28)} ${p.r.toFixed(1)}× spread  (n=${p.n})`));
  console.log("➡️  DIRECTED — straightest point-to-point movers (efficient migrants/dispersers):");
  pers.sort((a, b) => a.r - b.r).slice(0, 8).forEach((p) => console.log(`  ${p.sci.padEnd(28)} ${p.r.toFixed(1)}× spread  (n=${p.n})`));

  // 3. equator crossers + reach — p1/p99, NOT min/max (one bad fix ruins min/max)
  const pctl = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const crossers = [...reach.entries()].filter(([, a]) => a.length >= 200).map(([sci, a]) => {
    a.sort((x, y) => x - y);
    return { sci, lo: pctl(a, 0.01), hi: pctl(a, 0.99) };
  }).filter((r) => r.lo < -1 && r.hi > 1).map((r) => ({ sci: r.sci, span: r.hi - r.lo }));
  console.log(`\n🌍 EQUATOR-CROSSERS — ${crossers.length} species span both hemispheres (p1→p99 latitude):`);
  crossers.sort((a, b) => b.span - a.span).slice(0, 8).forEach((c) => console.log(`  ${c.sci.padEnd(28)} ${c.span.toFixed(0)}° of latitude`));
  console.log("  (records live in analyze-motion.ts — it applies the eligibility gates)");

  // 4. the data's own geography
  console.log("\n🗺️  WHERE THE TRACKING ACTUALLY IS (points per 10° latitude band):");
  const mx = Math.max(...latHist);
  for (let i = 17; i >= 0; i--) { const lo = i * 10 - 90; if (!latHist[i]) continue;
    console.log(`  ${String(lo).padStart(4)}°..${String(lo + 10).padStart(4)}°  ${"█".repeat(Math.round(latHist[i] / mx * 40))} ${(latHist[i] / 1e6).toFixed(2)}M`); }
  process.exit(0);
}

// crude landmark labels for hotspot cells (orientation only)
function nameLoc(la: number, lo: number): string {
  const near = (a: number, b: number, t: number) => Math.abs(a - b) < t;
  if (near(la, 36, 4) && near(lo, -5, 4)) return "(Strait of Gibraltar)";
  if (near(la, 54, 4) && near(lo, 6, 5)) return "(Wadden Sea / North Sea)";
  if (near(la, 60, 6) && near(lo, 20, 8)) return "(Baltic / Fennoscandia)";
  if (near(la, -54, 6) && near(lo, -38, 8)) return "(South Georgia / Scotia Sea)";
  if (near(la, 65, 8) && near(lo, -18, 8)) return "(Iceland)";
  if (near(la, 40, 5) && near(lo, -73, 6)) return "(US NE seaboard)";
  return "";
}
main().catch((e) => { console.error(e); process.exit(1); });
