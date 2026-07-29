// Measure BEFORE committing hours. Zenodo was harvested with the old parser and
// only 2.7% of records yielded tracks, vs Dryad's 20% on the same kind of data
// with the improved parser. Theory: the parser is the difference.
//
// This DRY-RUNS a random sample of previously-REJECTED Zenodo records through the
// NEW parser (parenthetical headers, comma-decimals, split Date/Time, DMY dates)
// and reports how many WOULD now yield a track. No DB writes, no ingestion —
// just the recovery rate, so we know whether a full re-harvest is worth it.
//
// Usage: pnpm tsx scripts/probe-zenodo-recovery.ts [sampleSize]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDelimited, detectDelim, detectColumns, trackiness, toNum, normalizeTs } from "../lib/csv-tracks";
import { normalizeLicense, isCommercialSafe } from "../lib/licenses";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const MAX_FILE_BYTES = 40 * 1024 * 1024;

async function main() {
  const sample = Number(process.argv[2] || 60);
  const attempted: number[] = JSON.parse(readFileSync(R("zenodo-attempted.json"), "utf8"));
  // which zenodo records actually made it into the corpus?
  const ingested = new Set<string>();
  for (const line of readFileSync(R("rescue/datasets.csv"), "utf8").split("\n")) {
    const m = line.match(/^"?zenodo:(\d+)"?/);
    if (m) ingested.add(m[1]);
  }
  const failures = attempted.filter((id) => !ingested.has(String(id)));
  console.log(`attempted ${attempted.length} · ingested ${ingested.size} · REJECTED ${failures.length}`);
  console.log(`probing a random ${sample} of the rejected with the NEW parser…\n`);

  // deterministic-ish spread across the list rather than a clustered head
  const step = Math.max(1, Math.floor(failures.length / sample));
  const pick = failures.filter((_, i) => i % step === 0).slice(0, sample);

  let checked = 0, wouldYield = 0, noOpenLicense = 0, noCandidateFile = 0, notTrack = 0;
  const wins: string[] = [];
  for (const id of pick) {
    checked++;
    try {
      const rec = await (await fetch(`https://zenodo.org/api/records/${id}`, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(30000) })).json();
      const license = normalizeLicense(rec?.metadata?.license?.id);
      if (!isCommercialSafe(license)) { noOpenLicense++; continue; }
      const cands = (rec.files ?? [])
        .filter((f: any) => /\.(csv|tsv|txt)$/i.test(f.key) && f.size <= MAX_FILE_BYTES && f.size > 200 && !/readme|metadata|license|citation/i.test(f.key))
        .sort((a: any, b: any) => (trackiness(b.key) - trackiness(a.key)) || (b.size - a.size));
      if (!cands.length) { noCandidateFile++; continue; }

      let hit = false;
      for (const f of cands.slice(0, 2)) {
        const res = await fetch(f.links.self, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(60000) });
        if (!res.ok) continue;
        const text = await res.text();
        const nl = text.indexOf("\n"); if (nl < 0) continue;
        const rows = parseDelimited(text, detectDelim(text.slice(0, nl)));
        if (rows.length < 3) continue;
        const col = detectColumns(rows[0]);
        if (col.lat < 0 || col.lon < 0 || col.time < 0) continue;
        // count genuinely parseable points
        let good = 0;
        for (let i = 1; i < Math.min(rows.length, 400); i++) {
          const r = rows[i];
          const la = toNum(r[col.lat]), lo = toNum(r[col.lon]);
          const ts = normalizeTs(r[col.time], col.time2 >= 0 ? r[col.time2] : undefined);
          if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && ts && !Number.isNaN(Date.parse(ts))) good++;
        }
        if (good >= 20) { hit = true; wins.push(`  ✓ zenodo:${id} — "${String(rec.metadata?.title).slice(0, 44)}" [${rows[0].slice(0, 4).join("|")}]`); break; }
      }
      if (hit) wouldYield++; else notTrack++;
    } catch { notTrack++; }
    if (checked % 10 === 0) process.stdout.write(`\r  checked ${checked}/${pick.length} · recovered ${wouldYield}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\n\n=== RECOVERY PROBE (previously-rejected Zenodo records) ===`);
  console.log(`  checked            : ${checked}`);
  console.log(`  WOULD NOW YIELD    : ${wouldYield}  → ${(100 * wouldYield / checked).toFixed(1)}% recovery rate`);
  console.log(`  no open license    : ${noOpenLicense}`);
  console.log(`  no candidate file  : ${noCandidateFile}`);
  console.log(`  still not a track  : ${notTrack}`);
  if (wins.length) { console.log(`\n  examples recovered by the new parser:`); wins.slice(0, 10).forEach((w) => console.log(w)); }
  const projected = Math.round(failures.length * wouldYield / checked);
  console.log(`\n  → projected across all ${failures.length} rejected: ~${projected.toLocaleString()} datasets recoverable (corpus currently has 255 from Zenodo)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
