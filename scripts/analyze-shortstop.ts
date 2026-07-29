// SHORT-STOPPING TEST — does a species winter progressively further north?
//
// The white stork advances its spring migration ~2.3 days/decade, yet its arrival
// shows NO correlation with breeding-ground temperature (r=-0.03 over 24 yrs). So
// the advance isn't thermal tracking. The leading alternative: SHORT-STOPPING —
// storks increasingly winter in Iberia (on landfill) instead of crossing the
// Sahara to the Sahel. If you start closer, you arrive earlier — no thermometer.
//
// Prediction: wintering latitude creeps north, and the FRACTION wintering north of
// the Sahara rises. Both are within-species trends, which this corpus can answer.
//
// Usage: pnpm tsx scripts/analyze-shortstop.ts ["Ciconia ciconia"]
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const NORTH_OF = 30;                  // °N — north of this = did NOT cross the Sahara
function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o;
}
const parseTs = (s: string) => Date.parse(s.slice(0, 19).replace(" ", "T") + "Z");
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
function fit(xs: number[], ys: number[]) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { slope: sxx ? sxy / sxx : 0, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}

async function main() {
  const target = process.argv[2] || "Ciconia ciconia";
  const ids = new Set<string>();
  const clean = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
  const H = clean[0].split(","), iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible");
  for (let i = 1; i < clean.length; i++) {
    const c = splitCsv(clean[i]);
    if (c[iElig] === "t" && c[iSci] === target && !BAD_SPECIES.has(c[iSci]) && !BAD_INDIVIDUALS.has(c[0])) ids.add(c[0]);
  }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));
  console.log(`${target}: ${ids.size} eligible individuals\n`);

  // winter position per (individual, winter-year). A winter spans Dec→Feb, so we
  // label it by the January year.
  const win = new Map<string, Map<number, number[]>>();   // ind → winterYear → lats
  const winLon = new Map<string, number[]>();             // ind → winter longitudes (for flyway ID)
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t" || outliers.has(+c[0]) || !ids.has(c[1])) continue;
    const t = parseTs(c[2]), la = +c[4], lo = +c[3];
    if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const d = new Date(t), mo = d.getUTCMonth();          // 0=Jan
    if (!(mo === 11 || mo === 0 || mo === 1)) continue;   // Dec, Jan, Feb only
    const wy = mo === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
    const m = win.get(c[1]) ?? win.set(c[1], new Map()).get(c[1])!;
    (m.get(wy) ?? m.set(wy, []).get(wy)!).push(la);
    (winLon.get(c[1]) ?? winLon.set(c[1], []).get(c[1])!).push(lo);
  }

  // FLYWAY SPLIT. The stork has two migratory populations that cannot be pooled:
  // western birds cross at Gibraltar → Iberia/West Africa; eastern birds cross at
  // the Bosphorus → East/South Africa. Pooling them makes the wintering latitude
  // whiplash between 40°N and -34°N purely by who was tagged that year.
  const flyway = new Map<string, "west" | "east">();
  for (const [ind, lons] of winLon) flyway.set(ind, median(lons) < 15 ? "west" : "east");
  const nWest = [...flyway.values()].filter((f) => f === "west").length;
  console.log(`flyways: ${nWest} western (Gibraltar→Iberia/W-Africa) · ${flyway.size - nWest} eastern (Bosphorus→E/S-Africa)\n`);

  for (const fw of ["west", "east"] as const) {
    const byYear = new Map<number, number[]>();
    for (const [ind, m] of win) {
      if (flyway.get(ind) !== fw) continue;
      for (const [wy, lats] of m) {
        if (lats.length < 5) continue;                    // needs real winter coverage
        (byYear.get(wy) ?? byYear.set(wy, []).get(wy)!).push(median(lats));
      }
    }
    const years = [...byYear.entries()].filter(([, a]) => a.length >= 3).sort((a, b) => a[0] - b[0]);
    console.log(`━━━ ${fw.toUpperCase()}ERN FLYWAY ━━━`);
    if (years.length < 6) { console.log("  too few winters with ≥3 animals\n"); continue; }
    console.log("  winter │ n │ median wintering lat │ % north of 30°N");
    const xs: number[] = [], ys: number[] = [], fy: number[] = [];
    for (const [wy, lats] of years) {
      const med = median(lats), frac = 100 * lats.filter((l) => l > NORTH_OF).length / lats.length;
      xs.push(wy); ys.push(med); fy.push(frac);
      console.log(`   ${wy}  │${String(lats.length).padStart(3)}│ ${med.toFixed(1).padStart(6)}°N            │ ${frac.toFixed(0).padStart(3)}% ${"█".repeat(Math.round(frac / 5))}`);
    }
    const lat = fit(xs, ys), fr = fit(xs, fy);
    console.log(`  → wintering latitude: ${(lat.slope * 10).toFixed(1)}°/decade (r=${lat.r.toFixed(2)}, ${xs.length} winters)`);
    console.log(`  → % skipping Sahara : ${(fr.slope * 10).toFixed(1)} pts/decade (r=${fr.r.toFixed(2)})\n`);
  }
  console.log(`\nNOTE: different animals are tracked in different years, so a trend can partly`);
  console.log(`reflect which populations were tagged — read alongside the per-year n.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
