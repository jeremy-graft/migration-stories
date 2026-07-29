// LENS 3 — Co-occurrence. Which species are in the same place at the same time?
// Bin every fix to a 2° cell × calendar month, collect the species present, then
// count pairs. IMPORTANT: pairs sharing ONE study site mostly reflect research
// effort (one project tagging several species), so we rank by the number of
// DISTINCT CELLS a pair shares — breadth across geography is far harder to fake
// and hints at genuine ecological overlap.
import "dotenv/config";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
function splitCsv(l: string) { const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o; }
import { BAD_SPECIES as BAD } from "../lib/bad-species";

async function main() {
  const sciOf = new Map<string, string>();
  const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n");
  for (let i = 1; i < inds.length; i++) { if (!inds[i]) continue; const c = splitCsv(inds[i]); if (c[4]) sciOf.set(c[0], c[4]); }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));

  // bin: 2° cell × year-month → species present
  const bins = new Map<string, Set<string>>();
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true, used = 0;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t") continue;
    if (outliers.has(+c[0])) continue;
    const sci = sciOf.get(c[1]); if (!sci || BAD.has(sci)) continue;
    const la = +c[4], lo = +c[3];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const ym = c[2].slice(0, 7);                       // YYYY-MM
    const key = `${Math.floor(la / 2)}_${Math.floor(lo / 2)}_${ym}`;
    (bins.get(key) ?? bins.set(key, new Set()).get(key)!).add(sci);
    used++;
  }
  console.log(`binned ${used.toLocaleString()} fixes into ${bins.size.toLocaleString()} space-time bins\n`);

  // pair → distinct cells shared (cell = the 2° square, ignoring month)
  const pairCells = new Map<string, Set<string>>();
  const pairBins = new Map<string, number>();
  for (const [key, sp] of bins) {
    if (sp.size < 2 || sp.size > 25) continue;         // skip solo bins & mega research hotspots
    const cell = key.split("_").slice(0, 2).join("_");
    const list = [...sp].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const pk = `${list[i]}|${list[j]}`;
      (pairCells.get(pk) ?? pairCells.set(pk, new Set()).get(pk)!).add(cell);
      pairBins.set(pk, (pairBins.get(pk) ?? 0) + 1);
    }
  }

  const rows = [...pairCells.entries()].map(([pk, cells]) => ({ pk, cells: cells.size, bins: pairBins.get(pk) ?? 0 }));
  console.log(`LENS 3 — CO-OCCURRENCE: ${rows.length.toLocaleString()} species pairs share space+time\n`);

  console.log("🤝 WIDEST co-occurrence (same place & month across the MOST distinct locations):");
  rows.sort((a, b) => b.cells - a.cells).slice(0, 15).forEach((r) => {
    const [a, b] = r.pk.split("|");
    console.log(`  ${String(r.cells).padStart(4)} cells · ${String(r.bins).padStart(5)} bins   ${a} ↔ ${b}`);
  });

  console.log("\n📍 MOST-SHARED single locations (2° cells hosting the most species):");
  const cellSp = new Map<string, Set<string>>();
  for (const [key, sp] of bins) {
    const cell = key.split("_").slice(0, 2).join("_");
    const s = cellSp.get(cell) ?? cellSp.set(cell, new Set()).get(cell)!;
    for (const x of sp) s.add(x);
  }
  [...cellSp.entries()].map(([c, s]) => { const [la, lo] = c.split("_").map(Number); return { la: la * 2 + 1, lo: lo * 2 + 1, n: s.size }; })
    .sort((a, b) => b.n - a.n).slice(0, 10)
    .forEach((c) => console.log(`  ${String(c.n).padStart(3)} species @ ${c.la.toFixed(0)}°, ${c.lo.toFixed(0)}°`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
