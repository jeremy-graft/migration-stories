// Export the corpus's headline numbers + the ignorance grid as ONE compact JSON,
// so the write-up (and later the website) render from real data rather than
// hand-copied figures. Static output = no database needed.
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const N_LAT = 36, N_LON = 72, STEP = 5;
const ebuf = readFileSync(R("etopo-0.25deg.bin"));
const elev = new Float32Array(ebuf.buffer, ebuf.byteOffset, ebuf.length / 4);
const elevAt = (la: number, lo: number) =>
  elev[Math.min(720, Math.max(0, Math.round((la + 90) / 0.25))) * 1441 +
       Math.min(1440, Math.max(0, Math.round((lo + 180) / 0.25)))];
function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o;
}

async function main() {
  const sciOf = new Map<string, string>();
  const species = new Set<string>();
  let eligible = 0;
  const clean = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
  const H = clean[0].split(","), iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible");
  for (let i = 1; i < clean.length; i++) {
    const c = splitCsv(clean[i]);
    if (c[iElig] !== "t" || !c[iSci] || BAD_SPECIES.has(c[iSci]) || BAD_INDIVIDUALS.has(c[0])) continue;
    sciOf.set(c[0], c[iSci]); species.add(c[iSci]); eligible++;
  }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));

  const sp: Set<string>[] = Array.from({ length: N_LAT * N_LON }, () => new Set());
  const pts = new Int32Array(N_LAT * N_LON);
  let total = 0, minY = 9999, maxY = 0;
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t" || outliers.has(+c[0])) continue;
    const s = sciOf.get(c[1]); if (!s) continue;
    const la = +c[4], lo = +c[3];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const y = +c[2].slice(0, 4); if (y > 1900 && y < 2100) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const k = Math.min(N_LAT - 1, Math.max(0, Math.floor((la + 90) / STEP))) * N_LON +
              Math.min(N_LON - 1, Math.max(0, Math.floor((lo + 180) / STEP)));
    sp[k].add(s); pts[k]++; total++;
  }

  // land fraction per cell (for "unwatched HABITAT" vs empty ocean)
  const land = new Uint8Array(N_LAT * N_LON);
  for (let i = 0; i < N_LAT; i++) for (let j = 0; j < N_LON; j++) {
    let l = 0, t = 0;
    for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) {
      const z = elevAt(-90 + i * STEP + a * 0.25, -180 + j * STEP + b * 0.25);
      if (Number.isFinite(z)) { t++; if (z >= 0) l++; }
    }
    land[i * N_LON + j] = t && l / t > 0.25 ? 1 : 0;
  }

  writeFileSync(R("rescue/findings.json"), JSON.stringify({
    corpus: { species: species.size, eligible, points: total, yearFrom: minY, yearTo: maxY },
    grid: { nLat: N_LAT, nLon: N_LON, step: STEP,
      species: Array.from(sp, (s) => s.size), points: Array.from(pts), land: Array.from(land) },
  }));
  console.log(`✓ rescue/findings.json — ${species.size} species · ${eligible.toLocaleString()} eligible · ${total.toLocaleString()} fixes · ${minY}–${maxY}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
