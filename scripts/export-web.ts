// Export a compact payload for the landing page: a 1° land bitmask (drawn as a
// dot-matrix Earth), the 5° species grid, and a handful of REAL hero tracks with
// the temperature each fix was moving through. Everything static — no DB, no API.
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";
import { slugify } from "../lib/earth-math";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const ebuf = readFileSync(R("etopo-0.25deg.bin"));
const elev = new Float32Array(ebuf.buffer, ebuf.byteOffset, ebuf.length / 4);
const elevAt = (la: number, lo: number) =>
  elev[Math.min(720, Math.max(0, Math.round((la + 90) / 0.25))) * 1441 +
       Math.min(1440, Math.max(0, Math.round((lo + 180) / 0.25)))];
const temp: (number | null)[][] = JSON.parse(readFileSync(R("temp-5deg.json"), "utf8"));
const tempAt = (la: number, lo: number, m: number) =>
  temp[m][Math.min(35, Math.max(0, Math.floor((la + 90) / 5))) * 72 +
          Math.min(71, Math.max(0, Math.floor((lo + 180) / 5)))];
function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o;
}

// Which animals to feature on the landing montage, and why each one earns its
// place. (The full browsable catalog lives at /explore; this is just the front
// door — a diverse, iconic handful.)
const HEROES: { sci: string; common: string; note: string }[] = [
  { sci: "Diomedea exulans", common: "wandering albatross", note: "362,017 km, roughly the distance to the Moon" },
  { sci: "Pagophila eburnea", common: "ivory gull", note: "229,791 km circling the high Arctic, rarely off the ice" },
  { sci: "Ciconia ciconia", common: "white stork", note: "108,824 km over six years, between Europe and Africa" },
  { sci: "Mirounga leonina", common: "southern elephant seal", note: "20,000 km to the Antarctic ice and home to within 11 km" },
  { sci: "Anser indicus", common: "bar-headed goose", note: "flies over the Himalaya, the highest migration on Earth" },
  { sci: "Megaptera novaeangliae", common: "humpback whale", note: "20,000 km across open ocean, over water miles deep" },
  { sci: "Aptenodytes patagonicus", common: "king penguin", note: "rides the Southern Ocean inside a narrow band of cold" },
  { sci: "Aquila chrysaetos", common: "golden eagle", note: "52,757 km ranging one territory across many years" },
  { sci: "Limosa lapponica", common: "bar-tailed godwit", note: "crosses the thermal bands the ocean birds follow" },
  { sci: "Vulpes lagopus", common: "arctic fox", note: "reached 87.0°N, out on the polar pack ice" },
];

async function main() {
  // ---- 1° land bitmask → base64, plus an ocean-depth byte per cell so the seabed
  //      can be drawn as a dim bathymetric stipple (shelves glow, abyss fades to
  //      the void). Depth is quantised in 30 m steps (0 = land/no ocean, 1..255). ----
  const NL = 180, NO = 360, bits = new Uint8Array((NL * NO) / 8);
  const odep = new Uint8Array(NL * NO);
  for (let i = 0; i < NL; i++) for (let j = 0; j < NO; j++) {
    const la = -90 + i + 0.5, lo = -180 + j + 0.5;
    const e = elevAt(la, lo);
    if (e >= 0) { const k = i * NO + j; bits[k >> 3] |= 128 >> (k & 7); }
    else odep[i * NO + j] = Math.max(1, Math.min(255, Math.round(-e / 30)));
  }

  // ---- pick one individual per hero species: the longest eligible clean track ----
  const want = new Map<string, { id: string; km: number; days: number; n: number }>();
  const clean = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
  const H = clean[0].split(",");
  const iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible"),
        iKm = H.indexOf("distance_km"), iDays = H.indexOf("days_span"), iN = H.indexOf("n_points");
  for (let i = 1; i < clean.length; i++) {
    const c = splitCsv(clean[i]);
    if (c[iElig] !== "t") continue;
    const sci = c[iSci];
    if (!HEROES.some((h) => h.sci === sci) || BAD_SPECIES.has(sci) || BAD_INDIVIDUALS.has(c[0])) continue;
    const km = +c[iKm];
    const cur = want.get(sci);
    if (!cur || km > cur.km) want.set(sci, { id: c[0], km, days: +c[iDays], n: +c[iN] });
  }
  const idToSci = new Map([...want].map(([sci, v]) => [v.id, sci]));
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));

  // ---- collect those tracks ----
  const raw = new Map<string, { t: number; la: number; lo: number }[]>();
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t" || outliers.has(+c[0]) || !idToSci.has(c[1])) continue;
    const t = Date.parse(c[2].slice(0, 19).replace(" ", "T") + "Z"), la = +c[4], lo = +c[3];
    if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    (raw.get(c[1]) ?? raw.set(c[1], []).get(c[1])!).push({ t, la, lo });
  }

  const TARGET = 340;
  const tracks = HEROES.map((h) => {
    const meta = want.get(h.sci); if (!meta) return null;
    const P = (raw.get(meta.id) ?? []).sort((a, b) => a.t - b.t);
    if (P.length < 20) return null;
    const step = Math.max(1, Math.floor(P.length / TARGET));
    // each point: [lon, lat, °C, day] where day = days-since-1970 (integer, for
    // the clock + syncing the Earth's season to the animal's own dates)
    const pts = P.filter((_, i) => i % step === 0).map((p) => {
      const m = new Date(p.t).getUTCMonth();
      const tc = tempAt(p.la, p.lo, m);
      return [+p.lo.toFixed(2), +p.la.toFixed(2), tc === null ? null : Math.round(tc), Math.round(p.t / 86400000)];
    });
    const temps = pts.map((p) => p[2]).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const band = temps.length ? temps[Math.floor(temps.length * 0.95)] - temps[Math.floor(temps.length * 0.05)] : null;
    // ideal camera framing: latitude is simple min/max; longitude must be circular
    // (a circumpolar animal spans every longitude → stays global; a regional one
    // gets a tight frame). Find the biggest empty longitude gap and frame the rest.
    const lats = pts.map((p) => p[1]);
    const latC = (Math.min(...lats) + Math.max(...lats)) / 2, latSpan = Math.max(...lats) - Math.min(...lats);
    const ls = [...new Set(pts.map((p) => Math.round(p[0])))].sort((a, b) => a - b);
    let maxGap = ls[0] + 360 - ls[ls.length - 1], gapAt = ls[ls.length - 1];
    for (let k = 1; k < ls.length; k++) { const g = ls[k] - ls[k - 1]; if (g > maxGap) { maxGap = g; gapAt = ls[k - 1]; } }
    const lonSpan = Math.max(0, 360 - maxGap);
    const lonC = (((gapAt + maxGap + lonSpan / 2) + 540) % 360) - 180;
    return { sci: h.sci, common: h.common, slug: slugify(h.sci), note: h.note, km: Math.round(meta.km),
             days: Math.round(meta.days), fixes: P.length, band,
             cam: { lon: +lonC.toFixed(1), lat: +latC.toFixed(1), lonSpan: Math.round(lonSpan), latSpan: Math.round(latSpan) },
             start: Math.round(P[0].t / 86400000), end: Math.round(P[P.length - 1].t / 86400000), pts };
  }).filter(Boolean);

  // ---- monthly temperature at 1° land dots, quantised to a signed byte (°C,
  //      clamped ±60), so the Earth can "breathe" through the year. Ocean/no-data
  //      cells are −128. 12 × 64,800 bytes → base64 ≈ 1 MB. ----
  const tbytes = new Int8Array(12 * NL * NO).fill(-128);
  for (let m = 0; m < 12; m++) for (let i = 0; i < NL; i++) for (let j = 0; j < NO; j++) {
    const la = -90 + i + 0.5, lo = -180 + j + 0.5;
    if (elevAt(la, lo) < 0) continue;                    // land dots only (that's all we draw)
    const t = tempAt(la, lo, m);
    if (t === null || !Number.isFinite(t)) continue;
    tbytes[m * NL * NO + i * NO + j] = Math.max(-60, Math.min(60, Math.round(t)));
  }

  const findings = JSON.parse(readFileSync(R("rescue/findings.json"), "utf8"));
  writeFileSync(R("rescue/web.json"), JSON.stringify({
    land: { nLat: NL, nLon: NO, bits: Buffer.from(bits).toString("base64") },
    oceanDepth: Buffer.from(odep).toString("base64"),             // seabed depth (30 m units) at 1°
    monthlyTemp: Buffer.from(tbytes.buffer).toString("base64"),   // 12 months of °C at 1°
    grid: findings.grid, corpus: findings.corpus, tracks,
  }));
  console.log(`✓ rescue/web.json`);
  for (const t of tracks as any[])
    console.log(`  ${t.common.padEnd(26)} ${String(t.pts.length).padStart(4)} pts · ${n(t.km)} km · band ${t.band ?? "?"}°C`);
}
const n = (x: number) => x.toLocaleString("en-US");
main().catch((e) => { console.error(e); process.exit(1); });
