// THE MAP OF OUR IGNORANCE — where has humanity never tracked an animal?
//
// Every other cross-species geographic question in this corpus is destroyed by
// effort bias (hotspots → Belgium, betweenness → topology). Here the bias IS the
// subject, so the corpus is uniquely well-suited: it is an honest record of where
// science has looked.
//
// "No data" alone would be trivial (the open ocean). So we use our own layers to
// ask the real question:
//   • ETOPO relief  → is this cell LAND or OCEAN? (unwatched habitat, not water)
//   • ERA5 temps    → what climate zone is it? (the tropics-vs-temperate test)
//
// Usage: pnpm tsx scripts/analyze-ignorance.ts
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const N_LAT = 36, N_LON = 72, STEP = 5;                     // 5° world grid (matches temp grid)

// --- relief: 0.25° ETOPO → land fraction per 5° cell ---
const ebuf = readFileSync(R("etopo-0.25deg.bin"));
const elev = new Float32Array(ebuf.buffer, ebuf.byteOffset, ebuf.length / 4);
const E_LAT = 721, E_LON = 1441, E_STEP = 0.25;
const elevAt = (la: number, lo: number) =>
  elev[Math.min(E_LAT - 1, Math.max(0, Math.round((la + 90) / E_STEP))) * E_LON +
       Math.min(E_LON - 1, Math.max(0, Math.round((lo + 180) / E_STEP)))];
// --- temperature: 5° ERA5 monthly climatology ---
const temp: (number | null)[][] = JSON.parse(readFileSync(R("temp-5deg.json"), "utf8"));

function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o;
}

async function main() {
  // ---- what we've tracked, per 5° cell ----
  const sciOf = new Map<string, string>();
  const clean = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
  const H = clean[0].split(","), iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible");
  for (let i = 1; i < clean.length; i++) {
    const c = splitCsv(clean[i]);
    if (c[iElig] === "t" && c[iSci] && !BAD_SPECIES.has(c[iSci]) && !BAD_INDIVIDUALS.has(c[0])) sciOf.set(c[0], c[iSci]);
  }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));
  const cellSp: Set<string>[] = Array.from({ length: N_LAT * N_LON }, () => new Set());
  const cellPts = new Float64Array(N_LAT * N_LON);   // INTENSITY, not mere presence
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let firstLine = true;
  for await (const line of rl) {
    if (firstLine) { firstLine = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t" || outliers.has(+c[0])) continue;
    const sci = sciOf.get(c[1]); if (!sci) continue;
    const la = +c[4], lo = +c[3];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const i = Math.min(N_LAT - 1, Math.max(0, Math.floor((la + 90) / STEP)));
    const j = Math.min(N_LON - 1, Math.max(0, Math.floor((lo + 180) / STEP)));
    cellSp[i * N_LON + j].add(sci);
    cellPts[i * N_LON + j]++;
  }

  // ---- classify every cell: land fraction + climate ----
  const landFrac = new Float32Array(N_LAT * N_LON);
  for (let i = 0; i < N_LAT; i++) for (let j = 0; j < N_LON; j++) {
    let land = 0, tot = 0;
    for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) {
      const la = -90 + i * STEP + a * 0.25, lo = -180 + j * STEP + b * 0.25;
      const z = elevAt(la, lo);
      if (Number.isFinite(z)) { tot++; if (z >= 0) land++; }
    }
    landFrac[i * N_LON + j] = tot ? land / tot : 0;
  }
  const meanT = (i: number, j: number) => {
    const vals = temp.map((m) => m[i * N_LON + j]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  // ---- the map ----
  const shade = (n: number) => (n === 0 ? "" : n < 3 ? "░" : n < 8 ? "▒" : n < 20 ? "▓" : "█");
  console.log("\n=== THE MAP OF OUR IGNORANCE ===");
  console.log("  '.' = LAND nobody has ever tracked an animal on   ' ' = unwatched ocean");
  console.log("  ░▒▓█ = tracked (increasing number of species)\n");
  for (let i = N_LAT - 1; i >= 0; i--) {
    let row = "";
    for (let j = 0; j < N_LON; j++) {
      const n = cellSp[i * N_LON + j].size;
      if (n > 0) row += shade(n);
      else row += landFrac[i * N_LON + j] > 0.25 ? "." : " ";
    }
    const lat = -90 + i * STEP + STEP / 2;
    console.log(`${String(Math.round(lat)).padStart(4)}° ${row}`);
  }

  // ---- the numbers: INTENSITY, because presence at 5° is meaningless ----
  const med = (a: number[]) => { const x=[...a].sort((p,q)=>p-q); return x.length? x[x.length>>1] : 0; };
  const zones: Record<string, { sp: number[]; pts: number[] }> = {
    "tropical (>20°C)": { sp: [], pts: [] }, "subtropical (10-20°C)": { sp: [], pts: [] },
    "temperate (0-10°C)": { sp: [], pts: [] }, "polar (<0°C)": { sp: [], pts: [] },
  };
  let landCells = 0, landAny = 0;
  for (let i = 0; i < N_LAT; i++) for (let j = 0; j < N_LON; j++) {
    if (landFrac[i * N_LON + j] <= 0.25) continue;
    landCells++; const n = cellSp[i * N_LON + j].size; if (n > 0) landAny++;
    const t = meanT(i, j); if (t === null) continue;
    const k = t > 20 ? "tropical (>20°C)" : t > 10 ? "subtropical (10-20°C)" : t > 0 ? "temperate (0-10°C)" : "polar (<0°C)";
    zones[k].sp.push(n); zones[k].pts.push(cellPts[i * N_LON + j]);
  }
  console.log(`
=== WHY "COVERAGE" LIES ===`);
  console.log(`  land cells with >=1 tracked animal: ${landAny}/${landCells} (${(100*landAny/landCells).toFixed(0)}%)`);
  console.log(`  ...but a 5deg cell is ~550km: ONE animal passing through once "covers" it.`);
  console.log(`  Real ignorance is THINNESS, so measure intensity:
`);
  console.log(`=== LAND: HOW WELL DO WE ACTUALLY KNOW EACH CLIMATE ZONE? ===`);
  console.log(`  zone                       cells   median species/cell   median fixes/cell   well-studied (>=5 spp)`);
  for (const [k, v] of Object.entries(zones)) {
    if (!v.sp.length) continue;
    const well = 100 * v.sp.filter((x) => x >= 5).length / v.sp.length;
    console.log(`  ${k.padEnd(24)} ${String(v.sp.length).padStart(4)}   ${String(med(v.sp)).padStart(14)}   ${med(v.pts).toLocaleString().padStart(15)}   ${well.toFixed(0).padStart(3)}%  ${"#".repeat(Math.round(well/3))}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
