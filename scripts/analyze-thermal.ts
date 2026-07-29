// LENS 1 — Thermal niche. Samples an ERA5 monthly temperature climatology
// (temp-5deg.json) at each fix's location+month, giving every species a thermal
// envelope. The prize: ISOTHERM-TRACKERS — animals that roam huge distances yet
// stay inside a narrow temperature band (they follow the water/air temperature,
// not the map). Coverage is limited to whatever cells the grid has.
import "dotenv/config";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const N_LON = 72;
const grid: (number | null)[][] = JSON.parse(readFileSync(R("temp-5deg.json"), "utf8"));
const cellIdx = (la: number, lo: number) =>
  Math.min(35, Math.max(0, Math.floor((la + 90) / 5))) * N_LON +
  Math.min(71, Math.max(0, Math.floor((lo + 180) / 5)));
const tempAt = (la: number, lo: number, month: number) => grid[month][cellIdx(la, lo)];
function splitCsv(l: string) { const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o; }
import { BAD_SPECIES as BAD } from "../lib/bad-species";
const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];

// TRUE longitudinal reach. max-min is WRONG across the antimeridian: an animal
// confined to the Bering Strait (179°E … 179°W) would score ~358° and look
// circumglobal. Instead, find the biggest EMPTY longitude gap and subtract it —
// a Bering bird has a huge empty gap over the Atlantic, so its real span is small.
function circularLonSpan(lonCells: Set<number>): number {
  const degs = [...lonCells].map((j) => j * 5 - 180 + 2.5).sort((a, b) => a - b);
  if (degs.length < 2) return 0;
  let maxGap = degs[0] + 360 - degs[degs.length - 1];        // the wrap-around gap
  for (let i = 1; i < degs.length; i++) maxGap = Math.max(maxGap, degs[i] - degs[i - 1]);
  return Math.max(0, 360 - maxGap);
}

async function main() {
  const sciOf = new Map<string, string>();
  const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n");
  for (let i = 1; i < inds.length; i++) { if (!inds[i]) continue; const c = splitCsv(inds[i]); if (c[4]) sciOf.set(c[0], c[4]); }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));

  const st = new Map<string, { t: number[]; cells: Set<number>; lonCells: Set<number>; laMin: number; laMax: number; loMin: number; loMax: number }>();
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true, sampled = 0, nogrid = 0;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t" || outliers.has(+c[0])) continue;
    const sci = sciOf.get(c[1]); if (!sci || BAD.has(sci)) continue;
    const la = +c[4], lo = +c[3];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const month = +c[2].slice(5, 7) - 1;
    if (!(month >= 0 && month < 12)) continue;
    const t = tempAt(la, lo, month);
    if (t === null || !Number.isFinite(t)) { nogrid++; continue; }
    let s = st.get(sci);
    if (!s) { s = { t: [], cells: new Set(), lonCells: new Set(), laMin: 91, laMax: -91, loMin: 181, loMax: -181 }; st.set(sci, s); }
    s.t.push(t);
    s.cells.add(cellIdx(la, lo));
    s.lonCells.add(Math.min(71, Math.max(0, Math.floor((lo + 180) / 5))));
    if (la < s.laMin) s.laMin = la; if (la > s.laMax) s.laMax = la;
    if (lo < s.loMin) s.loMin = lo; if (lo > s.loMax) s.loMax = lo;
    sampled++;
  }
  console.log(`\nsampled ${sampled.toLocaleString()} fixes against the thermal grid (${nogrid.toLocaleString()} fell outside covered cells)\n`);

  const arr = [...st.entries()].filter(([, s]) => s.t.length >= 200).map(([sci, s]) => {
    s.t.sort((a, b) => a - b);
    const p5 = pct(s.t, 0.05), p50 = pct(s.t, 0.5), p95 = pct(s.t, 0.95);
    return { sci, n: s.t.length, cells: s.cells.size, p5, p50, p95, breadth: p95 - p5, latSpan: s.laMax - s.laMin, lonSpan: circularLonSpan(s.lonCells) };
  });
  console.log(`species with a thermal envelope: ${arr.length}\n`);
  const T = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}°C`;

  console.log("🥶 COLDEST-living species (median temperature):");
  arr.slice().sort((a, b) => a.p50 - b.p50).slice(0, 10)
    .forEach((x) => console.log(`  ${x.sci.padEnd(28)} median ${T(x.p50).padStart(7)}   band ${T(x.p5)}…${T(x.p95)}`));

  console.log("\n🔥 WARMEST-living species (median temperature):");
  arr.slice().sort((a, b) => b.p50 - a.p50).slice(0, 8)
    .forEach((x) => console.log(`  ${x.sci.padEnd(28)} median ${T(x.p50).padStart(7)}   band ${T(x.p5)}…${T(x.p95)}`));

  console.log("\n🎯 ISOTHERM-TRACKERS — roam widely yet hold a NARROW thermal band:");
  console.log("   (score = ° longitude roamed per °C of thermal breadth)");
  console.log("   GUARDS: ≥25 distinct grid cells sampled and ≥1.5°C breadth — a species sitting");
  console.log("   in one cell trivially has a 'narrow band'; that's the grid, not the animal.");
  arr.filter((x) => x.lonSpan > 20 && x.cells >= 25 && x.breadth >= 1.5)
    .map((x) => ({ ...x, score: x.lonSpan / x.breadth }))
    .sort((a, b) => b.score - a.score).slice(0, 12)
    .forEach((x) => console.log(`  ${x.sci.padEnd(28)} ${x.lonSpan.toFixed(0).padStart(3)}° lon roamed · band only ${x.breadth.toFixed(1).padStart(4)}°C  (median ${T(x.p50)}, ${x.cells} cells)`));

  console.log("\n🌡️  WIDEST thermal tolerance (p5→p95 span):");
  arr.slice().sort((a, b) => b.breadth - a.breadth).slice(0, 8)
    .forEach((x) => console.log(`  ${x.sci.padEnd(28)} ${x.breadth.toFixed(1)}°C  (${T(x.p5)} … ${T(x.p95)})`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
