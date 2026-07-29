// Generate the site's icon + social preview image from the REAL data, so a shared
// link looks like the site instead of a blank card.
//   public/icon.svg       — favicon: the albatross loop, minimal
//   public/og.svg + .png  — 1200x630 link preview: dot-matrix Earth + the track
// SVG is written by hand (no deps); the PNG is rasterised via sharp IF INSTALLED
// (`pnpm add -D sharp`, then remove it again once you've regenerated og.png).
// sharp is NOT a committed dependency — it needs a native binary per platform,
// which is unnecessary risk in the deploy's install step for a script that only
// ever runs locally and once in a while. Its output (og.png) is committed as a
// plain static file, so the live site never needs sharp itself.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
// rescue/web.json (not the public copy): it still carries the corpus totals, which
// the public payload drops because the landing inlines them into its HTML.
const W = JSON.parse(readFileSync(R("rescue/web.json"), "utf8"));

// cold -> warm ramp, matching the site
function tcol(t: number | null): string {
  if (t === null || t === undefined) return "#96b4be";
  const p = Math.max(0, Math.min(1, (t + 20) / 50));
  return `rgb(${Math.round(88 + p * 167)},${Math.round(210 - p * 32)},${Math.round(230 - p * 153)})`;
}

const OGW = 1200, OGH = 630;

function build() {
  const bits = Buffer.from(W.land.bits, "base64");
  const NL = W.land.nLat, NO = W.land.nLon;
  const isLand = (i: number, j: number) => { const k = i * NO + j; return (bits[k >> 3] >> (7 - (k & 7))) & 1; };

  // ---------- OG card: whole world, equirectangular, cropped to the card ----------
  // Show 360 lon across the width; that fixes the scale, then centre on lat 10.
  const ppd = OGW / 360, latC = 10;
  const px = (lo: number) => OGW / 2 + lo * ppd;
  const py = (la: number) => OGH / 2 - (la - latC) * ppd;

  let dots = "";
  for (let i = 0; i < NL; i += 2) for (let j = 0; j < NO; j += 2) {
    if (!isLand(i, j)) continue;
    const la = -90 + i + 0.5, lo = -180 + j + 0.5;
    const y = py(la); if (y < -4 || y > OGH + 4) continue;
    dots += `<circle cx="${px(lo).toFixed(1)}" cy="${y.toFixed(1)}" r="1.6"/>`;
  }

  // EVERY featured track, so the card reads as a whole planet criss-crossed with
  // real journeys rather than one lonely squiggle in a corner.
  let paths = "";
  for (const t of W.tracks) {
    for (let i = 1; i < t.pts.length; i++) {
      const a = t.pts[i - 1], b = t.pts[i];
      const x1 = px(a[0]), x2 = px(b[0]);
      if (Math.abs(x2 - x1) > OGW * 0.6) continue;      // dateline wrap
      paths += `<line x1="${x1.toFixed(1)}" y1="${py(a[1]).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${py(b[1]).toFixed(1)}" stroke="${tcol(b[2])}" stroke-width="1.9"/>`;
    }
  }

  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="${OGW}" height="${OGH}" viewBox="0 0 ${OGW} ${OGH}">
<defs>
<filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
<feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
<stop offset="45%" stop-color="#03090C" stop-opacity="0"/>
<stop offset="78%" stop-color="#03090C" stop-opacity=".82"/>
<stop offset="100%" stop-color="#03090C" stop-opacity=".97"/>
</linearGradient>
</defs>
<rect width="${OGW}" height="${OGH}" fill="#03090C"/>
<g fill="#20495699">${dots}</g>
<g stroke-linecap="round" opacity=".9" filter="url(#glow)">${paths}</g>
<rect width="${OGW}" height="${OGH}" fill="url(#scrim)"/>
<text x="64" y="497" fill="#EAF4F6" font-family="Iowan Old Style,Palatino,Georgia,serif" font-size="82" font-weight="600" letter-spacing="-1.5">Where animals go</text>
<text x="64" y="551" fill="#8FAAB1" font-family="ui-monospace,SF Mono,Menlo,Consolas,monospace" font-size="25" letter-spacing="3.4">${W.corpus.species} SPECIES &#183; ${W.corpus.eligible.toLocaleString("en-US")} REAL ANIMALS</text>
</svg>`;
  writeFileSync(R("public/og.svg"), og);

  // ---------- favicon: just the albatross loop on the void ----------
  const alb = W.tracks.find((x: any) => x.sci === "Diomedea exulans");
  let ico = "";
  if (alb) {
    const lats = alb.pts.map((p: any) => p[1]), lons = alb.pts.map((p: any) => p[0]);
    const laMin = Math.min(...lats), laMax = Math.max(...lats), loMin = Math.min(...lons), loMax = Math.max(...lons);
    const s = 26 / Math.max(laMax - laMin, loMax - loMin);
    const fx = (lo: number) => 16 + (lo - (loMin + loMax) / 2) * s;
    const fy = (la: number) => 16 - (la - (laMin + laMax) / 2) * s;
    for (let i = 1; i < alb.pts.length; i++) {
      const a = alb.pts[i - 1], b = alb.pts[i];
      if (Math.abs(fx(b[0]) - fx(a[0])) > 20) continue;
      ico += `<line x1="${fx(a[0]).toFixed(1)}" y1="${fy(a[1]).toFixed(1)}" x2="${fx(b[0]).toFixed(1)}" y2="${fy(b[1]).toFixed(1)}" stroke="${tcol(b[2])}" stroke-width="1.5"/>`;
    }
  }
  writeFileSync(R("public/icon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`
    + `<rect width="32" height="32" fill="#03090C"/><g stroke-linecap="round" opacity=".95">${ico}</g></svg>`);

  console.log("✓ public/og.svg + public/icon.svg");
  return og;
}

async function main() {
  const og = build();
  // Social scrapers need a raster. sharp ships with the project's deps tree.
  try {
    const { default: sharp } = await import("sharp");
    await sharp(Buffer.from(og)).png().toFile(R("public/og.png"));
    console.log("✓ public/og.png (1200x630)");
  } catch {
    console.log("… sharp unavailable, og.png not rasterised (og.svg still written)");
  }
  if (!existsSync(R("public/og.png"))) console.log("⚠ no og.png — link previews will be weaker");
}
main().catch((e) => { console.error(e); process.exit(1); });
