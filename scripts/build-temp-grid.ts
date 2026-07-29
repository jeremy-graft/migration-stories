// Build a global monthly temperature climatology (ERA5 via Open-Meteo archive,
// free/no-key) on a 5° grid → temp-5deg.json. ERA5 covers land AND ocean.
//
// RATE LIMITS: Open-Meteo counts EACH COORDINATE against the quota (~600/min),
// so 100 coords per request must be spaced ≥10s apart. Earlier attempt used
// 400ms and got 429'd out of 61% of the world. We now pace, back off, SAVE AFTER
// EVERY BATCH, and resume by filling only still-missing cells.
//
// Usage: pnpm tsx scripts/build-temp-grid.ts     (re-run to resume/fill gaps)
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../temp-5deg.json", import.meta.url));
const STEP = 5, N_LAT = 36, N_LON = 72;
const YEARS = { start: "2018-01-01", end: "2019-12-31" };
const BATCH = 100, SPACING_MS = 12000;           // 100 coords / 12s ≈ 500/min < 600 limit

const latOf = (i: number) => -90 + STEP * i + STEP / 2;
const lonOf = (j: number) => -180 + STEP * j + STEP / 2;

async function fetchBatch(cells: { i: number; j: number }[]): Promise<any[]> {
  const lat = cells.map((c) => latOf(c.i).toFixed(3)).join(",");
  const lon = cells.map((c) => lonOf(c.j).toFixed(3)).join(",");
  const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${YEARS.start}&end_date=${YEARS.end}&daily=temperature_2m_mean&timezone=UTC`;
  // Open-Meteo's free tier has minute AND hourly/daily windows. When the hourly
  // window is spent, the only cure is to WAIT IT OUT — so back off exponentially
  // up to 15min and stay patient (~2.5h total). Combined with save-every-batch,
  // the build simply outlasts the limit instead of giving up.
  for (let a = 0; a < 15; a++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "migration-stories/0.1" }, signal: AbortSignal.timeout(180000) });
      if (r.status === 429) {
        const wait = Math.min(900000, 30000 * 2 ** a);
        console.log(`  429 — quota spent, waiting ${Math.round(wait / 60000)}m for the window to roll (attempt ${a + 1}/15)`);
        await new Promise((s) => setTimeout(s, wait));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return Array.isArray(j) ? j : [j];
    } catch (e) {
      if (a >= 14) { console.log(`  batch failed: ${(e as Error).message}`); return []; }
      await new Promise((s) => setTimeout(s, 15000));
    }
  }
  return [];
}

async function main() {
  // resume: load existing grid, keep filled cells
  let grid: (number | null)[][];
  if (existsSync(OUT)) { grid = JSON.parse(readFileSync(OUT, "utf8")); console.log("resuming from existing grid"); }
  else grid = Array.from({ length: 12 }, () => new Array(N_LAT * N_LON).fill(null));

  const todo: { i: number; j: number }[] = [];
  for (let i = 0; i < N_LAT; i++) for (let j = 0; j < N_LON; j++) {
    if (grid.every((m) => m[i * N_LON + j] === null)) todo.push({ i, j });
  }
  console.log(`cells still missing: ${todo.length} / ${N_LAT * N_LON} → ${Math.ceil(todo.length / BATCH)} batches @ ${SPACING_MS / 1000}s spacing`);
  if (!todo.length) { console.log("grid already complete."); process.exit(0); }

  for (let b = 0; b < todo.length; b += BATCH) {
    const chunk = todo.slice(b, b + BATCH);
    const res = await fetchBatch(chunk);
    let got = 0;
    res.forEach((loc: any, k: number) => {
      const c = chunk[k]; if (!c) return;
      const times: string[] = loc.daily?.time ?? [];
      const temps: number[] = loc.daily?.temperature_2m_mean ?? [];
      const sum = new Array(12).fill(0), n = new Array(12).fill(0);
      for (let d = 0; d < times.length; d++) {
        const t = temps[d]; if (!Number.isFinite(t)) continue;
        const m = +times[d].slice(5, 7) - 1; sum[m] += t; n[m]++;
      }
      let any = false;
      for (let m = 0; m < 12; m++) if (n[m]) { grid[m][c.i * N_LON + c.j] = +(sum[m] / n[m]).toFixed(2); any = true; }
      if (any) got++;
    });
    writeFileSync(OUT, JSON.stringify(grid));               // SAVE EVERY BATCH
    const filled = grid[0].filter((v) => v !== null).length;
    console.log(`  batch ${Math.floor(b / BATCH) + 1}/${Math.ceil(todo.length / BATCH)}: +${got} cells · total ${filled}/${N_LAT * N_LON}`);
    if (b + BATCH < todo.length) await new Promise((s) => setTimeout(s, SPACING_MS));
  }
  console.log(`\n✓ done — ${grid[0].filter((v) => v !== null).length}/${N_LAT * N_LON} cells`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
