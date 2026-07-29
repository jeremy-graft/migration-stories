// THE MIGRATION NETWORK — the planet's movement as a graph.
//
// Nodes  = 2° cells. Edges = observed animal transitions between adjacent cells.
// Then BETWEENNESS CENTRALITY: cells lying on the most shortest-paths through the
// network — i.e. the chokepoints migration must funnel through.
//
// EFFORT BIAS IS THE ENEMY (this corpus's hotspots are research hubs, not
// biodiversity). Defences:
//   • Edges are weighted/filtered by DISTINCT SPECIES + DISTINCT INDIVIDUALS —
//     never by point count, which is just tracking frequency.
//   • Edges used by a single individual are dropped as noise.
//   • Reported alongside species-count so a "bottleneck" used by one well-funded
//     study is visible as such.
// Nothing here fixes the underlying sampling bias — read the output accordingly.
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const CELL = 2;                       // degrees
const MAX_HOP_KM = 1500;              // longer "transitions" are data gaps, not moves
const hav = (la1: number, lo1: number, la2: number, lo2: number) => {
  const d = Math.PI / 180, r = 6371;
  const a = Math.sin((la2 - la1) * d / 2) ** 2 + Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin((lo2 - lo1) * d / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
};
function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o;
}
const parseTs = (s: string) => Date.parse(s.slice(0, 19).replace(" ", "T") + "Z");
const cellOf = (la: number, lo: number) => `${Math.floor(la / CELL)}_${Math.floor(lo / CELL)}`;
const cellCentre = (k: string) => { const [a, b] = k.split("_").map(Number); return { la: a * CELL + CELL / 2, lo: b * CELL + CELL / 2 }; };

async function main() {
  // canonical table: species + eligibility
  const sciOf = new Map<string, string>();
  const clean = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
  const H = clean[0].split(","), iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible");
  for (let i = 1; i < clean.length; i++) {
    const c = splitCsv(clean[i]);
    if (c[iElig] !== "t") continue;
    if (c[iSci] && !BAD_SPECIES.has(c[iSci]) && !BAD_INDIVIDUALS.has(c[0])) sciOf.set(c[0], c[iSci]);
  }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));
  console.log(`eligible individuals: ${sciOf.size.toLocaleString()}`);

  // group clean points per individual
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

  // build the graph: edge = a real move between two different cells
  const edgeSp = new Map<string, Set<string>>();     // edge → species using it
  const edgeInd = new Map<string, Set<string>>();    // edge → individuals using it
  const nodeSp = new Map<string, Set<string>>();     // cell → species present
  for (const [indId, flat] of byInd) {
    const sci = sciOf.get(indId)!;
    const n = flat.length / 3;
    const P = Array.from({ length: n }, (_, i) => ({ t: flat[i * 3], la: flat[i * 3 + 1], lo: flat[i * 3 + 2] })).sort((a, b) => a.t - b.t);
    for (let i = 0; i < P.length; i++) {
      const k = cellOf(P[i].la, P[i].lo);
      (nodeSp.get(k) ?? nodeSp.set(k, new Set()).get(k)!).add(sci);
      if (i === 0) continue;
      const a = cellOf(P[i - 1].la, P[i - 1].lo);
      if (a === k) continue;
      if (hav(P[i - 1].la, P[i - 1].lo, P[i].la, P[i].lo) > MAX_HOP_KM) continue;  // data gap, not a move
      const e = a < k ? `${a}|${k}` : `${k}|${a}`;
      (edgeSp.get(e) ?? edgeSp.set(e, new Set()).get(e)!).add(sci);
      (edgeInd.get(e) ?? edgeInd.set(e, new Set()).get(e)!).add(indId);
    }
  }
  // noise filter: an edge crossed by only ONE animal is not a corridor
  const edges = [...edgeSp.entries()].filter(([e]) => (edgeInd.get(e)?.size ?? 0) >= 2);
  const nodes = [...new Set(edges.flatMap(([e]) => e.split("|")))];
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const adj: number[][] = nodes.map(() => []);
  for (const [e] of edges) { const [a, b] = e.split("|"); const i = idx.get(a)!, j = idx.get(b)!; adj[i].push(j); adj[j].push(i); }
  console.log(`graph: ${nodes.length.toLocaleString()} cells · ${edges.length.toLocaleString()} corridors (≥2 individuals)\n`);

  // Brandes betweenness, approximated from a sample of sources (exact is O(V*E))
  const SOURCES = Math.min(nodes.length, 700);
  const step = Math.max(1, Math.floor(nodes.length / SOURCES));
  const C = new Float64Array(nodes.length);
  let done = 0;
  for (let s = 0; s < nodes.length; s += step) {
    const sigma = new Float64Array(nodes.length), d = new Int32Array(nodes.length).fill(-1), delta = new Float64Array(nodes.length);
    const P: number[][] = nodes.map(() => []);
    sigma[s] = 1; d[s] = 0;
    const Q: number[] = [s]; const S: number[] = [];
    for (let qi = 0; qi < Q.length; qi++) {
      const v = Q[qi]; S.push(v);
      for (const w of adj[v]) {
        if (d[w] < 0) { d[w] = d[v] + 1; Q.push(w); }
        if (d[w] === d[v] + 1) { sigma[w] += sigma[v]; P[w].push(v); }
      }
    }
    for (let si = S.length - 1; si >= 0; si--) {
      const w = S[si];
      for (const v of P[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) C[w] += delta[w];
    }
    if (++done % 100 === 0) process.stdout.write(`\r  betweenness: ${done}/${Math.ceil(nodes.length / step)} sources`);
  }
  console.log(`\n`);

  const ranked = nodes.map((k, i) => ({ k, c: C[i], sp: nodeSp.get(k)?.size ?? 0, deg: adj[i].length }))
    .sort((a, b) => b.c - a.c);

  console.log("🕸️  MIGRATION BOTTLENECKS — cells carrying the most shortest-paths:");
  console.log("    (species = distinct species recorded in the cell; watch for single-study artefacts)");
  for (const r of ranked.slice(0, 15)) {
    const { la, lo } = cellCentre(r.k);
    console.log(`  ${la.toFixed(0).padStart(4)}°, ${lo.toFixed(0).padStart(5)}°   betweenness ${(r.c / 1000).toFixed(0).padStart(5)}k · ${String(r.sp).padStart(3)} species · degree ${String(r.deg).padStart(2)}  ${place(la, lo)}`);
  }

  console.log("\n🌍 BUSIEST CORRIDORS — single hops used by the most DIFFERENT species:");
  edges.map(([e, sp]) => ({ e, n: sp.size })).sort((a, b) => b.n - a.n).slice(0, 10).forEach((x) => {
    const [a, b] = x.e.split("|").map(cellCentre);
    console.log(`  ${String(x.n).padStart(3)} species   ${a.la.toFixed(0)}°,${a.lo.toFixed(0)}° → ${b.la.toFixed(0)}°,${b.lo.toFixed(0)}°  ${place(a.la, a.lo)}`);
  });
}

// coarse landmark hints — orientation only, not authoritative
function place(la: number, lo: number): string {
  const n = (a: number, b: number, t: number) => Math.abs(a - b) < t;
  if (n(la, 36, 3) && n(lo, -5, 3)) return "≈ Strait of Gibraltar";
  if (n(la, 41, 3) && n(lo, 29, 3)) return "≈ Bosphorus";
  if (n(la, 9, 3) && n(lo, -79, 3)) return "≈ Panama";
  if (n(la, 66, 4) && n(lo, -169, 5)) return "≈ Bering Strait";
  if (n(la, 30, 3) && n(lo, 33, 3)) return "≈ Suez / Sinai";
  if (n(la, 53, 3) && n(lo, 5, 4)) return "≈ Wadden Sea (INBO hub — effort bias!)";
  if (n(la, -54, 4) && n(lo, -37, 5)) return "≈ South Georgia";
  if (n(la, 13, 4) && n(lo, 43, 4)) return "≈ Bab-el-Mandeb";
  return "";
}
main().catch((e) => { console.error(e); process.exit(1); });
