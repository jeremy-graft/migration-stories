// (a) Coordinate sanity + robust records, and (b) the global migration pulse —
// both from one grouped pass over the rescued track_points. For each animal we
// sort its fixes by time, flag isolated teleports (a point >2000 km from BOTH
// temporal neighbours = a corrupt coordinate), then use the CLEAN points for
// records, and the clean segment speeds for the seasonal pulse.
import "dotenv/config";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES } from "../lib/bad-species";

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
const parseTs = (s: string) => Date.parse(s.slice(0, 19).replace(" ", "T") + "Z");

async function main() {
  const sciOf = new Map<string, string>();
  const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n");
  for (let i = 1; i < inds.length; i++) { if (!inds[i]) continue; const c = splitCsv(inds[i]); if (c[4]) sciOf.set(c[0], c[4]); }

  // group each individual's fixes: flat [id, t, la, lo] per point
  const byInd = new Map<string, number[]>();
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true, total = 0;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t") continue;
    const la = +c[4], lo = +c[3], t = parseTs(c[2]);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(t)) continue;
    (byInd.get(c[1]) ?? byInd.set(c[1], []).get(c[1])!).push(+c[0], t, la, lo);
    total++;
  }
  console.log(`grouped ${total.toLocaleString()} fixes across ${byInd.size.toLocaleString()} animals\n`);

  const outliers: number[] = [];
  // records (clean) + pulse accumulators
  let longest = { km: 0, sci: "", id: "" };
  let north = { la: -91, sci: "" }, south = { la: 91, sci: "" };
  const monthN = Array.from({ length: 12 }, () => ({ km: 0, d: 0 }));
  const monthS = Array.from({ length: 12 }, () => ({ km: 0, d: 0 }));

  for (const [indId, flat] of byInd) {
    const sci = sciOf.get(indId) || "?";
    const n = flat.length / 4;
    // sort indices by time
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => flat[a * 4 + 1] - flat[b * 4 + 1]);
    const P = order.map((i) => ({ id: flat[i * 4], t: flat[i * 4 + 1], la: flat[i * 4 + 2], lo: flat[i * 4 + 3], bad: false }));
    // flag isolated teleports
    for (let i = 0; i < P.length; i++) {
      const prev = P[i - 1], next = P[i + 1];
      const dp = prev ? hav(prev.la, prev.lo, P[i].la, P[i].lo) : Infinity;
      const dn = next ? hav(P[i].la, P[i].lo, next.la, next.lo) : Infinity;
      const isolated = (prev && next) ? (dp > 2000 && dn > 2000) : ((dp > 3000) && (dn > 3000));
      if (isolated) { P[i].bad = true; outliers.push(P[i].id); }
    }
    // clean per-individual stats + pulse from consecutive clean pairs
    let cleanKm = 0, cnt = 0, laMin = 91, laMax = -91, tMin = Infinity, tMax = -Infinity;
    let lastGood: typeof P[0] | null = null;
    for (const p of P) {
      if (p.bad) continue;
      cnt++;
      if (p.la < laMin) laMin = p.la; if (p.la > laMax) laMax = p.la;
      if (p.t < tMin) tMin = p.t; if (p.t > tMax) tMax = p.t;
      if (lastGood) {
        const km = hav(lastGood.la, lastGood.lo, p.la, p.lo);
        const days = (p.t - lastGood.t) / 86400000;
        cleanKm += km;
        if (days > 0.2 && days <= 30) {
          const kmday = km / days;
          if (kmday <= 500) {
            const m = new Date((lastGood.t + p.t) / 2).getUTCMonth();
            const bin = (p.la + lastGood.la) / 2 >= 0 ? monthN : monthS;
            bin[m].km += km; bin[m].d += days;
          }
        }
      }
      lastGood = p;
    }
    // only REAL tracks with plausible sustained pace may hold a record
    const daysSpan = (tMax - tMin) / 86400000;
    const eligible = cnt >= 20 && daysSpan <= 2200 && cleanKm / Math.max(daysSpan, 1) <= 300
      && sci !== "?" && !BAD_SPECIES.has(sci) && Math.abs(laMax) < 88 && Math.abs(laMin) < 88;
    if (eligible) {
      if (laMax > north.la) north = { la: laMax, sci };
      if (laMin < south.la) south = { la: laMin, sci };
      if (cleanKm > longest.km) longest = { km: cleanKm, sci, id: indId };
    }
  }

  writeFileSync(R("rescue/outliers.json"), JSON.stringify(outliers));
  const bySpec = new Map<string, number>();
  for (const id of outliers) { /* count is by point; species lookup below is approximate */ }
  console.log(`(a) 🧹 COORDINATE SANITY`);
  console.log(`  flagged ${outliers.length.toLocaleString()} isolated-teleport points → rescue/outliers.json`);
  console.log(`  CLEAN records:`);
  console.log(`    northernmost fix: ${north.la.toFixed(1)}°N — ${north.sci}`);
  console.log(`    southernmost fix: ${(-south.la).toFixed(1)}°S — ${south.sci}`);
  console.log(`    longest journey (recomputed clean): ${Math.round(longest.km).toLocaleString()} km — ${longest.sci}`);

  console.log(`\n(b) 🌐 GLOBAL MIGRATION PULSE — mean movement (km/day) by month:`);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rateN = monthN.map((x) => x.d ? x.km / x.d : 0);
  const rateS = monthS.map((x) => x.d ? x.km / x.d : 0);
  const mx = Math.max(...rateN, ...rateS);
  console.log("  Northern hemisphere animals:");
  for (let m = 0; m < 12; m++) console.log(`    ${names[m]}  ${"█".repeat(Math.round(rateN[m] / mx * 36))} ${rateN[m].toFixed(1)} km/day`);
  console.log("  Southern hemisphere animals:");
  for (let m = 0; m < 12; m++) console.log(`    ${names[m]}  ${"█".repeat(Math.round(rateS[m] / mx * 36))} ${rateS[m].toFixed(1)} km/day`);
  const peakN = names[rateN.indexOf(Math.max(...rateN))], peakS = names[rateS.indexOf(Math.max(...rateS))];
  console.log(`\n  Peak movement — N: ${peakN} · S: ${peakS}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
