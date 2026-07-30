// #1 — Directional range-shift detection from OUR OWN tracks.
// For each species with enough multi-year data, regress the annual mean latitude
// against year: a positive slope = the sampled animals are, on average, sitting
// further poleward over time. We then cross-check the sign against BioShifts'
// independent literature estimate — agreement is the meaningful signal.
//
// HONEST CAVEATS (this is a SCREEN, not proof):
//  • Different individuals in different years → a "trend" can be who-was-tagged.
//  • Tags deployed at fixed colonies anchor latitude to the deployment site.
//  • Seasonal sampling changes shift mean latitude without any range change.
// So: treat these as candidates to investigate; the BioShifts-corroborated,
// many-individual, high-|r| ones are the ones worth believing.
//
// Usage: pnpm tsx scripts/analyze-shifts.ts
import "dotenv/config";
import { sql, client } from "../db/index";

interface Yr { yr: number; mlat: number; n: number; inds: number }

// weighted least-squares slope (deg/yr) + weighted Pearson r
function wlreg(pts: { x: number; y: number; w: number }[]) {
  let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0, swyy = 0;
  for (const { x, y, w } of pts) { sw += w; swx += w * x; swy += w * y; swxx += w * x * x; swxy += w * x * y; swyy += w * y * y; }
  const mx = swx / sw, my = swy / sw;
  const cov = swxy / sw - mx * my, vx = swxx / sw - mx * mx, vy = swyy / sw - my * my;
  return { slope: cov / vx, r: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0 };
}

async function main() {
  const MIN_YEARS = 6, MIN_SPAN = 8, MIN_INDIV = 8, KM_PER_DEG = 110.6;

  console.log("Aggregating annual mean latitude per species (scanning track points)…");
  const rows = (await sql`
    select i.scientific_name sp, extract(year from tp.ts)::int yr,
           avg(tp.lat)::float mlat, count(*)::int n, count(distinct tp.individual_id)::int inds
    from track_points tp join individuals i on i.id = tp.individual_id
    where tp.visible and i.scientific_name is not null and tp.ts is not null
    group by i.scientific_name, extract(year from tp.ts)
    having count(*) >= 5`) as any[];

  const bySp = new Map<string, Yr[]>();
  for (const r of rows) (bySp.get(r.sp) ?? bySp.set(r.sp, []).get(r.sp)!).push({ yr: r.yr, mlat: r.mlat, n: r.n, inds: r.inds });

  // BioShifts latitudinal median (km/yr, + = poleward) per species
  const bs = (await sql`
    select scientific_name sp, percentile_cont(0.5) within group (order by shift_rate) med
    from species_shifts where gradient = 'Latitudinal' and unit = 'km/year' and shift_rate is not null
    group by scientific_name`) as any[];
  const bsMap = new Map(bs.map((r) => [String(r.sp).toLowerCase(), Number(r.med)]));

  const out: any[] = [];
  for (const [sp, ys] of bySp) {
    if (ys.length < MIN_YEARS) continue;
    const years = ys.map((y) => y.yr);
    const span = Math.max(...years) - Math.min(...years);
    if (span < MIN_SPAN) continue;
    const totInd = ys.reduce((s, y) => s + y.inds, 0);
    if (totInd < MIN_INDIV) continue;
    const { slope, r } = wlreg(ys.map((y) => ({ x: y.yr, y: y.mlat, w: y.inds })));
    const kmYr = slope * KM_PER_DEG;
    const bsMed = bsMap.get(sp.toLowerCase());
    out.push({
      sp, kmYr, r, span, nYears: ys.length, totInd,
      indPerYr: totInd / ys.length,
      bsMed: bsMed ?? null,
      agree: bsMed != null ? Math.sign(kmYr) === Math.sign(bsMed) : null,
    });
  }

  const fmt = (o: any) =>
    `  ${o.kmYr >= 0 ? "↑" : "↓"} ${String(o.sp).padEnd(28)} ${o.kmYr.toFixed(1).padStart(6)} km/yr  r=${o.r.toFixed(2).padStart(5)}  ` +
    `${o.span}y/${o.nYears}yrs  ${String(o.totInd).padStart(4)}ind (${o.indPerYr.toFixed(1)}/yr)` +
    `${o.bsMed != null ? `  BioShifts=${o.bsMed.toFixed(1)} ${o.agree ? "✓AGREE" : "✗oppose"}` : ""}`;

  const strong = out.filter((o) => Math.abs(o.r) >= 0.4 && o.indPerYr >= 1.5);
  strong.sort((a, b) => Math.abs(b.kmYr * b.r) - Math.abs(a.kmYr * a.r));

  console.log(`\nSpecies with a multi-year track trend (≥${MIN_YEARS} yrs, span ≥${MIN_SPAN}, ≥${MIN_INDIV} indiv): ${out.length}`);
  console.log(`Of those, a CLEAR trend (|r|≥0.4, ≥1.5 indiv/yr): ${strong.length}\n`);

  const corroborated = strong.filter((o) => o.agree === true);
  console.log(`★ BioShifts-CORROBORATED directional signals (our tracks + literature agree) — ${corroborated.length}:`);
  corroborated.slice(0, 25).forEach((o) => console.log(fmt(o)));

  console.log(`\nStrongest trends WITHOUT a BioShifts cross-check (investigate, lower confidence):`);
  strong.filter((o) => o.agree == null).slice(0, 15).forEach((o) => console.log(fmt(o)));

  const opposed = strong.filter((o) => o.agree === false);
  console.log(`\n⚠ Our tracks OPPOSE BioShifts (likely our confound, or a local reversal) — ${opposed.length}:`);
  opposed.slice(0, 8).forEach((o) => console.log(fmt(o)));

  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
