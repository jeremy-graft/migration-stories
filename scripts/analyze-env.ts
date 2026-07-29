// Environmental analysis, reading the rescued CSVs directly — NO database, so
// nothing can corrupt and nothing hangs. Streams track_points.csv line-by-line,
// samples the 4 MB relief grid per point, aggregates per species. First real
// environmental angle: the terrain & ocean depths each species moves through.
import "dotenv/config";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const STEP = 0.25, N_LAT = 721, N_LON = 1441;
const gbuf = readFileSync(R("etopo-0.25deg.bin"));
const grid = new Float32Array(gbuf.buffer, gbuf.byteOffset, gbuf.length / 4);
const elevAt = (lat: number, lon: number) =>
  grid[Math.min(N_LAT - 1, Math.max(0, Math.round((lat + 90) / STEP))) * N_LON +
       Math.min(N_LON - 1, Math.max(0, Math.round((lon + 180) / STEP)))];

// quote-aware CSV line split
function splitCsv(line: string): string[] {
  const out: string[] = []; let f = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(f); f = ""; }
    else f += c;
  }
  out.push(f); return out;
}

interface S { vals: number[]; ocean: number }
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

async function main() {
  // skip the known corrupt teleport points (consistent with the other analyses)
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));
  // individuals.csv: col0=id, col4=scientific_name
  const sciOf = new Map<string, string>();
  const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n");
  for (let i = 1; i < inds.length; i++) {
    if (!inds[i]) continue;
    const c = splitCsv(inds[i]);
    if (c[4]) sciOf.set(c[0], c[4]);
  }
  console.log(`individuals: ${sciOf.size.toLocaleString()} with species`);

  // stream track_points.csv: col1=individual_id, col3=lon, col4=lat, col5=visible
  const stats = new Map<string, S>();
  let total = 0, used = 0;
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    total++;
    const c = line.split(",");                       // track_points fields are comma-free
    if (c[5] !== "t" || outliers.has(+c[0])) continue;
    const sp = sciOf.get(c[1]); if (!sp || BAD_SPECIES.has(sp)) continue;
    const lat = +c[4], lon = +c[3];
    const z = elevAt(lat, lon);
    if (!Number.isFinite(z)) continue;
    let s = stats.get(sp);
    if (!s) { s = { vals: [], ocean: 0 }; stats.set(sp, s); }
    s.vals.push(z); used++; if (z < 0) s.ocean++;
    if (total % 1000000 === 0) process.stdout.write(`\r  streamed ${(total / 1e6).toFixed(1)}M`);
  }
  console.log(`\r  streamed ${total.toLocaleString()} points, used ${used.toLocaleString()} across ${stats.size} species.\n`);

  // percentiles (robust to GPS outliers): p5 = "deep habitat", p50 = typical, p95 = "high habitat"
  const arr = [...stats.entries()].filter(([, s]) => s.vals.length >= 200).map(([sp, s]) => {
    s.vals.sort((a, b) => a - b);
    return { sp, n: s.vals.length, oceanPct: s.ocean / s.vals.length, p5: pct(s.vals, 0.05), p50: pct(s.vals, 0.5), p95: pct(s.vals, 0.95) };
  });
  const fm = (m: number) => `${m >= 0 ? "+" : ""}${Math.round(m).toLocaleString()}m`;

  console.log("🌊 Deepest habitat (5th-pct depth, species >50% over ocean):");
  arr.filter((x) => x.oceanPct > 0.5).sort((a, b) => a.p5 - b.p5).slice(0, 12)
    .forEach((x) => console.log(`  ${x.sp.padEnd(28)} p5 ${fm(x.p5).padStart(8)}  (median ${fm(x.p50)}, ${(x.oceanPct * 100).toFixed(0)}% ocean)`));

  console.log("\n⛰️  Highest habitat (95th-pct elevation):");
  arr.sort((a, b) => b.p95 - a.p95).slice(0, 12)
    .forEach((x) => console.log(`  ${x.sp.padEnd(28)} p95 ${fm(x.p95).padStart(7)}  (median ${fm(x.p50)})`));

  console.log("\n🏔️→🌊 Greatest robust range (p5→p95) within one species:");
  arr.map((x) => ({ ...x, range: x.p95 - x.p5 })).sort((a, b) => b.range - a.range).slice(0, 10)
    .forEach((x) => console.log(`  ${x.sp.padEnd(28)} ${fm(x.p5)} → ${fm(x.p95)}  (${Math.round(x.p95 - x.p5).toLocaleString()}m)`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
