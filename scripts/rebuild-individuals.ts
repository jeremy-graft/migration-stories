// CANONICAL individuals table, rebuilt from the CLEANED points.
//
// Why: rescue/individuals.csv carries metrics computed at INGEST — before the
// timestamp repair, the teleport quarantine, and the blocklist. That stale
// distance_km is what kept resurrecting the zombie "430,366 km pintail". Every
// downstream number should descend from clean points, computed once, here.
//
// Emits rescue/individuals_clean.csv with robust fields + an `eligible` flag
// encoding everything we learned the hard way about what a trustworthy track is.
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
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
const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
// circular longitude reach — max-min lies across the antimeridian
function circularLonSpan(lons: number[]): number {
  const d = [...new Set(lons.map((x) => Math.round(x)))].sort((a, b) => a - b);
  if (d.length < 2) return 0;
  let maxGap = d[0] + 360 - d[d.length - 1];
  for (let i = 1; i < d.length; i++) maxGap = Math.max(maxGap, d[i] - d[i - 1]);
  return Math.max(0, 360 - maxGap);
}

async function main() {
  const meta = new Map<string, string[]>();
  const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n");
  for (let i = 1; i < inds.length; i++) { if (!inds[i]) continue; const c = splitCsv(inds[i]); if (c[0]) meta.set(c[0], c); }
  const outliers = new Set<number>(JSON.parse(readFileSync(R("rescue/outliers.json"), "utf8")));

  // group CLEAN points per individual
  const byInd = new Map<string, number[]>();   // flat [t, la, lo]
  const rl = createInterface({ input: createReadStream(R("rescue/track_points.csv")), crlfDelay: Infinity });
  let first = true, kept = 0, dropped = 0;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(",");
    if (c[5] !== "t") continue;
    if (outliers.has(+c[0]) || BAD_INDIVIDUALS.has(c[1])) { dropped++; continue; }
    const m = meta.get(c[1]); if (!m) continue;
    if (m[4] && BAD_SPECIES.has(m[4])) { dropped++; continue; }
    const t = parseTs(c[2]), la = +c[4], lo = +c[3];
    if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    (byInd.get(c[1]) ?? byInd.set(c[1], []).get(c[1])!).push(t, la, lo);
    kept++;
  }
  console.log(`clean points: ${kept.toLocaleString()} (dropped ${dropped.toLocaleString()} quarantined)`);

  const rows: string[] = ["id,dataset_id,source_individual_id,name,scientific_name,n_points,track_start,track_end,days_span,distance_km,km_per_day,lat_p1,lat_p50,lat_p99,lon_circular_span,eligible"];
  let eligibleCount = 0;
  for (const [id, flat] of byInd) {
    const n = flat.length / 3;
    const P = Array.from({ length: n }, (_, i) => ({ t: flat[i * 3], la: flat[i * 3 + 1], lo: flat[i * 3 + 2] }))
      .sort((a, b) => a.t - b.t);
    let dist = 0;
    for (let i = 1; i < P.length; i++) dist += hav(P[i - 1].la, P[i - 1].lo, P[i].la, P[i].lo);
    const days = (P[P.length - 1].t - P[0].t) / 86400000;
    const kmDay = dist / Math.max(days, 1);
    const lats = P.map((p) => p.la).sort((a, b) => a - b);
    const m = meta.get(id)!;
    // everything we learned about a trustworthy track, in one flag
    const eligible = n >= 20 && days <= 2200 && kmDay <= 300 && !!m[4];
    if (eligible) eligibleCount++;
    const q = (s: string) => (s && (s.includes(",") || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s ?? "");
    rows.push([
      id, q(m[1]), q(m[2]), q(m[3]), q(m[4]), n,
      new Date(P[0].t).toISOString(), new Date(P[P.length - 1].t).toISOString(),
      days.toFixed(1), dist.toFixed(1), kmDay.toFixed(2),
      pct(lats, 0.01).toFixed(3), pct(lats, 0.5).toFixed(3), pct(lats, 0.99).toFixed(3),
      circularLonSpan(P.map((p) => p.lo)).toFixed(0), eligible ? "t" : "f",
    ].join(","));
  }
  writeFileSync(R("rescue/individuals_clean.csv"), rows.join("\n"));
  console.log(`✓ rescue/individuals_clean.csv — ${(rows.length - 1).toLocaleString()} individuals, ${eligibleCount.toLocaleString()} eligible`);
}
main().catch((e) => { console.error(e); process.exit(1); });
