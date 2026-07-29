// Build the browsable catalog: for every eligible species, take its best (longest,
// clean) individual and emit a small per-animal file the journey page fetches on
// demand, plus one manifest for the /explore index. The heavy Earth grids are NOT
// duplicated here — journey pages reuse them from /data/web.json (cached once).
//
//   public/data/journey/<slug>.json  — one animal: track + framing + stats
//   public/data/journeys.json        — manifest: [{slug, sci, common, group, …}]
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { BAD_SPECIES, BAD_INDIVIDUALS, NON_SPECIES, SYNONYM_DUPLICATES } from "../lib/bad-species";
import { slugify, wrap } from "../lib/earth-math";
import { normalizeLicense } from "../lib/licenses";

// A tiny signature of the track's own shape, for the catalog cards: the animal's
// real path decimated and normalised into a 100x60 box, aspect preserved so a
// circumpolar loop still reads as a loop and a pole-to-tropics dash as a dash.
// Longitudes are taken relative to the track's own centre, so dateline-straddling
// animals don't smear across the whole box.
function sparkline(pts: (number | null)[][], lonC: number): string {
  const MAXP = 48;
  const step = Math.max(1, Math.ceil(pts.length / MAXP));
  const sel = pts.filter((_, i) => i % step === 0);
  if (sel.length < 2) return "";
  const xs = sel.map((p) => wrap((p[0] as number) - lonC));
  const ys = sel.map((p) => p[1] as number);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
  const BW = 100, BH = 60, PAD = 5;
  const s = Math.min((BW - 2 * PAD) / w, (BH - 2 * PAD) / h);
  const ox = (BW - w * s) / 2, oy = (BH - h * s) / 2;
  // integer precision: 1 unit is 1% of the box, far finer than a 240px card shows,
  // and it keeps the manifest (inlined into the catalog page) roughly a third smaller
  let d = "", px = NaN, py = NaN;
  for (let i = 0; i < sel.length; i++) {
    const X = Math.round(ox + (xs[i] - x0) * s);
    const Y = Math.round(BH - (oy + (ys[i] - y0) * s));   // flip: north up
    if (X === px && Y === py) continue;                    // drop repeats after rounding
    d += (d ? "L" : "M") + X + " " + Y;
    px = X; py = Y;
  }
  return d;
}

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
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
const n = (x: number) => x.toLocaleString("en-US");

// curated notes for the flagships (others get a factual one); keep them human.
const CURATED: Record<string, string> = {
  "Diomedea exulans": "362,017 km, roughly the distance to the Moon",
  "Pagophila eburnea": "229,791 km circling the high Arctic, rarely off the ice",
  "Ciconia ciconia": "108,824 km over six years, between Europe and Africa",
  "Mirounga leonina": "20,000 km to the Antarctic ice and home to within 11 km",
  "Anser indicus": "flies over the Himalaya, the highest migration on Earth",
  "Megaptera novaeangliae": "20,000 km across open ocean, over water miles deep",
  "Aptenodytes patagonicus": "rides the Southern Ocean inside a narrow band of cold",
  "Aquila chrysaetos": "52,757 km ranging one territory across many years",
  "Limosa lapponica": "crosses the thermal bands the ocean birds follow",
  "Vulpes lagopus": "reached 87.0°N, out on the polar pack ice",
};

async function main() {
  // ---- best eligible individual per species ----
  interface Best { id: string; ds: string; sci: string; km: number; days: number; n: number; latLo: number; latHi: number }
  const best = new Map<string, Best>();
  const clean = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
  const H = clean[0].split(",");
  const iId = 0, iDs = H.indexOf("dataset_id"), iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible"),
        iKm = H.indexOf("distance_km"), iDays = H.indexOf("days_span"), iN = H.indexOf("n_points"),
        iP1 = H.indexOf("lat_p1"), iP99 = H.indexOf("lat_p99");
  for (let i = 1; i < clean.length; i++) {
    const c = splitCsv(clean[i]);
    if (c[iElig] !== "t") continue;
    const sci = c[iSci];
    if (BAD_SPECIES.has(sci) || BAD_INDIVIDUALS.has(c[iId]) || NON_SPECIES.has(sci) || SYNONYM_DUPLICATES.has(sci)) continue;
    const km = +c[iKm];
    const cur = best.get(sci);
    if (!cur || km > cur.km)
      best.set(sci, { id: c[iId], ds: c[iDs], sci, km, days: +c[iDays], n: +c[iN], latLo: +c[iP1], latHi: +c[iP99] });
  }

  // ---- attribution per dataset. CC BY REQUIRES credit in the UI, so every
  //      journey carries its source, publisher, DOI and license. ----
  interface Attrib { source: string; title: string; doi: string | null; license: string; citation: string | null; publisher: string | null }
  const dsRows = readFileSync(R("rescue/datasets.csv"), "utf8").split("\n").filter(Boolean);
  const HD = splitCsv(dsRows[0]);
  const kId = HD.indexOf("id"), kSrc = HD.indexOf("source"), kTitle = HD.indexOf("title"),
        kDoi = HD.indexOf("doi"), kLic = HD.indexOf("license"), kCite = HD.indexOf("citation"),
        kPub = HD.indexOf("publisher");
  const dsMap = new Map<string, Attrib>();
  for (let i = 1; i < dsRows.length; i++) {
    const c = splitCsv(dsRows[i]);
    if (!c[kId]) continue;
    dsMap.set(c[kId], {
      source: c[kSrc] || "", title: (c[kTitle] || "").trim(), doi: (c[kDoi] || "").trim() || null,
      license: normalizeLicense(c[kLic]), citation: (c[kCite] || "").trim() || null,
      publisher: (c[kPub] || "").trim() || null,
    });
  }
  const idToSci = new Map([...best.values()].map((b) => [b.id, b.sci]));
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));
  const meta: Record<string, { common: string; group: string }> =
    existsSync(R("rescue/species-meta.json")) ? JSON.parse(readFileSync(R("rescue/species-meta.json"), "utf8")) : {};

  // ---- one streaming pass over all track points, bucketed by target individual ----
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

  mkdirSync(R("public/data/journey"), { recursive: true });
  const TARGET = 400;
  const manifest: any[] = [];
  let written = 0, named = 0;
  const licCount: Record<string, number> = {};
  const missingAttrib: string[] = [];

  for (const b of best.values()) {
    const P = (raw.get(b.id) ?? []).sort((a, z) => a.t - z.t);
    if (P.length < 20) continue;
    const step = Math.max(1, Math.floor(P.length / TARGET));
    const pts = P.filter((_, i) => i % step === 0).map((p) => {
      const m = new Date(p.t).getUTCMonth();
      const tc = tempAt(p.la, p.lo, m);
      return [+p.lo.toFixed(2), +p.la.toFixed(2), tc === null ? null : Math.round(tc), Math.round(p.t / 86400000)];
    });
    const temps = pts.map((p) => p[2]).filter((v): v is number => v !== null).sort((a, z) => a - z);
    const band = temps.length ? temps[Math.floor(temps.length * 0.95)] - temps[Math.floor(temps.length * 0.05)] : null;
    // dateline-aware framing (same as the landing hero)
    const lats = pts.map((p) => p[1] as number);
    const latC = (Math.min(...lats) + Math.max(...lats)) / 2, latSpan = Math.max(...lats) - Math.min(...lats);
    const ls = [...new Set(pts.map((p) => Math.round(p[0] as number)))].sort((a, z) => a - z);
    let maxGap = ls[0] + 360 - ls[ls.length - 1], gapAt = ls[ls.length - 1];
    for (let k = 1; k < ls.length; k++) { const g = ls[k] - ls[k - 1]; if (g > maxGap) { maxGap = g; gapAt = ls[k - 1]; } }
    const lonSpan = Math.max(0, 360 - maxGap);
    const lonC = (((gapAt + maxGap + lonSpan / 2) + 540) % 360) - 180;

    const slug = slugify(b.sci);
    const common = (meta[b.sci]?.common || "").trim();
    const group = meta[b.sci]?.group || "Other";
    if (common) named++;
    const km = Math.round(b.km), days = Math.round(b.days);
    const note = CURATED[b.sci] || `${n(km)} km tracked over ${n(days)} days`;
    const attrib = dsMap.get(b.ds) ?? null;
    if (attrib) licCount[attrib.license] = (licCount[attrib.license] || 0) + 1;
    else missingAttrib.push(b.sci);

    writeFileSync(R(`public/data/journey/${slug}.json`), JSON.stringify({
      slug, sci: b.sci, common, group, note, km, days, fixes: P.length, band, attrib,
      cam: { lon: +lonC.toFixed(1), lat: +latC.toFixed(1), lonSpan: Math.round(lonSpan), latSpan: Math.round(latSpan) },
      start: Math.round(P[0].t / 86400000), end: Math.round(P[P.length - 1].t / 86400000), pts,
    }));
    manifest.push({
      slug, sci: b.sci, common, group, km, days, fixes: P.length, band,
      license: attrib?.license ?? "OTHER",
      spark: sparkline(pts, lonC),
      // median temperature drives the card's colour, so the grid itself shows the
      // cold-to-warm spread of the corpus instead of 320 identical tiles
      tmid: temps.length ? temps[Math.floor(temps.length / 2)] : null,
    });
    written++;
  }

  manifest.sort((a, z) => z.km - a.km);
  writeFileSync(R("public/data/journeys.json"), JSON.stringify(manifest));
  console.log(`✓ ${written} journeys written (${named} with a common name)`);
  console.log(`✓ public/data/journeys.json (${(JSON.stringify(manifest).length / 1024).toFixed(0)} KB)`);
  console.log(`  licenses: ${Object.entries(licCount).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  if (missingAttrib.length) console.log(`  ⚠ ${missingAttrib.length} without attribution: ${missingAttrib.slice(0, 5).join(", ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
