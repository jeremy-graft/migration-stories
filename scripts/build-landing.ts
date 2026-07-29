// Generate landing.html from rescue/web.json. Everything is real: the Earth is
// an ETOPO land mask, its dots are tinted by that month's ERA5 temperature and
// BREATHE through the year in step with the animal's own dates, the tracks are
// real animals coloured by the temperature they moved through, and the ribbon is
// the temperature each animal actually experienced.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const W = JSON.parse(readFileSync(R("rescue/web.json"), "utf8"));
const n = (x: number) => x.toLocaleString("en-US");

const html = `<title>Where Animals Go</title>
<style>
  /* A telemetry instrument: committed to a single dark world by design —
     glowing tracks over an unlit Earth. A light ground would undo the idea. */
  :root{
    --void:#03090C; --deep:#06141A; --panel:#091E25; --rule:#123039;
    --land:#12343E; --cold:#58D2E6; --warm:#FFB24D; --text:#D8E8EB; --muted:#6E8C94;
    --display:ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    --body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--void);color:var(--text);font-family:var(--body);
       font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
  h1,h2{font-family:var(--display);font-weight:600;text-wrap:balance;margin:0;letter-spacing:-.02em}
  h1{font-size:clamp(2.6rem,7.5vw,5.6rem);line-height:.98}
  h2{font-size:clamp(1.6rem,3.6vw,2.5rem);line-height:1.1}
  p{margin:0}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .label{font-family:var(--mono);font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
  .wrap{max-width:74rem;margin:0 auto;padding:0 clamp(1.1rem,4vw,2.5rem)}
  .prose{max-width:36rem;color:#B9CFD4}

  /* ---------- hero ---------- */
  .hero{position:relative;min-height:100svh;display:flex;flex-direction:column;justify-content:flex-end;
        overflow:hidden;border-bottom:1px solid var(--rule)}
  #earth{position:absolute;inset:0;width:100%;height:100%;display:block}
  .veil{position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(120% 85% at 50% 28%,transparent 32%,var(--void) 100%)}
  .heroInner{position:relative;padding:0 0 clamp(1.5rem,4vw,3rem);display:flex;flex-direction:column;gap:1.3rem}
  .heroInner .prose{max-width:31rem}
  /* instrument readout */
  .hud{position:absolute;top:clamp(1rem,3vw,2rem);right:clamp(1.1rem,4vw,2.5rem);text-align:right;
       display:flex;flex-direction:column;gap:.12rem;pointer-events:none;min-width:11rem}
  .hud .nm{font-style:italic;font-family:var(--display);font-size:1.15rem;color:var(--text)}
  .hud .km{font-family:var(--mono);font-size:clamp(1.15rem,2.6vw,1.7rem);font-variant-numeric:tabular-nums;
         font-weight:600;letter-spacing:-.02em;color:var(--warm)}
  .hud .dt{font-family:var(--mono);font-size:.92rem;color:var(--cold);letter-spacing:.02em}
  /* temperature ribbon */
  .ribbon{display:flex;flex-direction:column;gap:.35rem;max-width:32rem}
  #ribbon{width:100%;height:46px;display:block}
  .ribHead{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
  .ribHead b{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:.8rem;color:var(--warm);font-weight:600}
  /* animal picker */
  .picker{display:flex;flex-wrap:wrap;gap:.5rem}
  .picker button{font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;
        background:transparent;color:var(--muted);border:1px solid var(--rule);padding:.42rem .8rem;
        cursor:pointer;transition:color .2s,border-color .2s,background .2s}
  .picker button:hover{color:var(--text);border-color:var(--cold)}
  .picker button[aria-pressed="true"]{color:var(--void);background:var(--cold);border-color:var(--cold)}
  .stats{display:flex;flex-wrap:wrap;gap:clamp(1.2rem,4vw,3rem);border-top:1px solid var(--rule);padding-top:1.1rem}
  .stat b{display:block;font-family:var(--mono);font-variant-numeric:tabular-nums;
          font-size:clamp(1.2rem,2.6vw,1.7rem);font-weight:600;letter-spacing:-.02em}

  section{padding:clamp(4rem,10vw,7.5rem) 0;border-bottom:1px solid var(--rule)}
  .head{display:flex;flex-direction:column;gap:1rem;margin-bottom:2.5rem}

  /* ---------- thermal bands ---------- */
  .bands{display:flex;flex-direction:column;gap:.1rem}
  .band{display:grid;grid-template-columns:minmax(9rem,15rem) 1fr auto;gap:1rem;align-items:center;
        padding:.6rem 0;border-bottom:1px solid var(--rule)}
  .band .who{display:flex;flex-direction:column}
  .band .who span{font-size:.78rem;color:var(--muted)}
  .band .who em{font-style:italic;font-family:var(--display);font-size:1rem}
  .rail{position:relative;height:.5rem;background:#0B2027;overflow:hidden}
  .rail i{position:absolute;top:0;bottom:0;display:block}
  .band .v{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:.85rem;color:var(--warm);white-space:nowrap}
  .ramp{height:.4rem;background:linear-gradient(90deg,var(--cold),#9AD7A8,var(--warm));margin-top:.3rem}

  /* ---------- ignorance ---------- */
  .plate{border:1px solid var(--rule);background:var(--deep);padding:clamp(.5rem,1.6vw,1rem)}
  #ign{width:100%;height:auto;display:block}
  .legend{display:flex;flex-wrap:wrap;gap:1.2rem;margin-top:1rem}
  .key{display:flex;align-items:center;gap:.45rem;font-family:var(--mono);font-size:.7rem;color:var(--muted)}
  .sw{width:.8rem;height:.8rem;flex:none}

  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1px;background:var(--rule);
         border:1px solid var(--rule)}
  .card{background:var(--deep);padding:1.4rem;display:flex;flex-direction:column;gap:.5rem}
  .card h3{margin:0;font-family:var(--display);font-size:1.12rem;font-weight:600;line-height:1.25}
  .card p{font-size:.92rem;color:#AFC6CC}
  a{color:var(--cold)}
  .cta{display:inline-block;margin-top:.4rem;font-family:var(--mono);font-size:.78rem;letter-spacing:.1em;
       text-transform:uppercase;border:1px solid var(--cold);padding:.6rem 1.1rem;text-decoration:none}
  .cta:hover{background:var(--cold);color:var(--void)}
  footer{padding:3rem 0 4.5rem;color:var(--muted);font-size:.85rem;display:flex;flex-direction:column;gap:.7rem}
  :focus-visible{outline:2px solid var(--warm);outline-offset:3px}
  @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>

<div class="hero">
  <canvas id="earth"></canvas>
  <div class="veil"></div>
  <div class="hud">
    <span class="label">now tracking</span>
    <span class="nm" id="hudName">&mdash;</span>
    <span class="km" id="hudKm">&mdash;</span>
    <span class="dt" id="hudDate">&mdash;</span>
    <span class="label" id="hudSub">&mdash;</span>
  </div>
  <div class="wrap heroInner">
    <span class="label">${n(W.corpus.species)} species &middot; ${n(W.corpus.eligible)} animals &middot; ${W.corpus.yearFrom}&ndash;${W.corpus.yearTo}</span>
    <h1>Where<br>animals go</h1>
    <p class="prose">Every dot is land, tinted by its temperature that month. Every line is an animal
       that was really there. Watch the world breathe through the seasons while the animal moves &mdash;
       the ocean-wanderers keep the same colour the whole way around.</p>
    <div class="ribbon">
      <div class="ribHead"><span class="label">temperature it&rsquo;s moving through</span><b id="ribNow">&mdash;</b></div>
      <canvas id="ribbon"></canvas>
    </div>
    <div class="picker" id="picker"></div>
    <div class="stats">
      <div class="stat"><b>${(W.corpus.points / 1e6).toFixed(2)}M</b><span class="label">fixes</span></div>
      <div class="stat"><b>${n(W.corpus.species)}</b><span class="label">species</span></div>
      <div class="stat"><b>${W.corpus.yearTo - W.corpus.yearFrom}</b><span class="label">years</span></div>
      <div class="stat"><b>7</b><span class="label">open repositories</span></div>
    </div>
  </div>
</div>

<section>
  <div class="wrap">
    <div class="head">
      <span class="label">Finding 01 &middot; thermal niche</span>
      <h2>Some animals cross the planet without ever leaving their temperature</h2>
      <p class="prose">A sooty tern covers 160&deg; of longitude inside a band just
         <span class="mono">3.4&deg;C</span> wide. It isn&rsquo;t wandering the map &mdash; it is
         following the water. Land-breeding migrants do the opposite: the bar-tailed godwit travels
         just as far, but punches straight through <span class="mono">19.6&deg;C</span> of thermal
         range, from Arctic tundra to tropical coast.</p>
    </div>
    <div class="bands" id="bands"></div>
    <div class="ramp"></div>
    <p class="label" style="margin-top:.5rem">cold &rarr; warm &middot; width = 5th to 95th percentile of temperature experienced</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="head">
      <span class="label">Finding 02 &middot; coverage</span>
      <h2>A map of where nobody has ever watched</h2>
      <p class="prose">Colour is how many species have been tracked through each 5&deg; cell.
         Grey is land where no tracked animal has ever been recorded. This is not a map of
         animals &mdash; it is a map of where science has pointed its antennas.</p>
    </div>
    <div class="plate"><canvas id="ign"></canvas></div>
    <div class="legend">
      <span class="key"><span class="sw" style="background:var(--land)"></span>untracked land</span>
      <span class="key"><span class="sw" style="background:rgba(88,210,230,.3)"></span>1&ndash;2 species</span>
      <span class="key"><span class="sw" style="background:rgba(88,210,230,.65)"></span>3&ndash;7</span>
      <span class="key"><span class="sw" style="background:var(--cold)"></span>8&ndash;19</span>
      <span class="key"><span class="sw" style="background:var(--warm)"></span>20+</span>
    </div>
    <p class="prose" style="margin-top:1.6rem">Coverage flatters us. A 5&deg; cell is 550&nbsp;km
       across, so one stork crossing the Sahara once makes it look studied. Measured by intensity,
       a typical tropical cell holds <span class="mono">381</span> fixes against the subtropics&rsquo;
       <span class="mono">1,287</span> &mdash; and polar land holds a median of
       <span class="mono">one species</span> and <span class="mono">eleven</span> fixes.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="head">
      <span class="label">What it can&rsquo;t tell us</span>
      <h2>The limits are the point</h2>
      <p class="prose">Every limit below was learned by being refuted &mdash; a confident result that
         fell apart under checking. They are the reason to trust the findings above them.</p>
    </div>
    <div class="cards">
      <div class="card">
        <h3>Geography is funding</h3>
        <p>Asked where migration converges, the corpus answers &ldquo;Belgium&rdquo; &mdash; the home
           of its largest data source. Three methods each rediscovered the funders, not the biology.</p>
      </div>
      <div class="card">
        <h3>Variance beats trend</h3>
        <p>Stork arrival dates vary ~13 days between birds, so a 5.5-day shift is detectable. Wintering
           latitude varies by 70&deg;, so a 1&ndash;3&deg;/decade shift never will be.</p>
      </div>
      <div class="card">
        <h3>Extremes lie</h3>
        <p>Raw minima and maxima produced a killifish at the North Pole, a 430,000&nbsp;km pintail, and
           five phantom circumnavigators that were Bering Strait animals straddling the dateline.</p>
      </div>
    </div>
    <a class="cta" href="https://claude.ai/code/artifact/30239285-1e14-495d-b4b2-426f135d36ed">Read the full findings</a>
  </div>
</section>

<footer><div class="wrap" style="display:flex;flex-direction:column;gap:.7rem">
  <p><span class="label">Sources</span> GBIF &middot; Movebank &middot; Zenodo &middot; Dryad &middot;
     NOAA/IOOS Animal Telemetry Network &middot; USGS ScienceBase &middot; PANGAEA &mdash; openly
     licensed (CC0 / CC&nbsp;BY) only.</p>
  <p><span class="label">Environment</span> ETOPO1 relief &middot; ERA5 temperature via Open-Meteo.</p>
</div></footer>

<script>
const D = ${JSON.stringify({ land: W.land, oceanDepth: W.oceanDepth, monthlyTemp: W.monthlyTemp, grid: W.grid, tracks: W.tracks })};
const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
const css = getComputedStyle(document.documentElement);
const C = (k) => css.getPropertyValue(k).trim();
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DIM = [31,28,31,30,31,30,31,31,30,31,30,31];

/* bright track/ribbon colour: cold(-20) → warm(+30) */
function tcol(t, a){
  if (t === null || t === undefined) return "rgba(150,180,190," + a + ")";
  const p = Math.max(0, Math.min(1, (t + 20) / 50));
  const r = Math.round(88 + p*(255-88)), g = Math.round(210 + p*(178-210)), b = Math.round(230 + p*(77-230));
  return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}
/* DARK land-dot tint: cold bluish, warm brownish, all dim so tracks stay the hero */
function landTint(t){
  if (t === null) return "rgb(26,44,50)";
  const p = Math.max(0, Math.min(1, (t + 35) / 65));
  return "rgb(" + Math.round(16+p*38) + "," + Math.round(42-p*4) + "," + Math.round(54-p*30) + ")";
}
/* DIM seabed tint by depth: shallow shelves glow faint teal, abyss sinks to the
   void — just enough structure (ridges, shelves, trenches) to place a marine track */
function oceanTint(dm){
  const p = Math.max(0, Math.min(1, dm/5000));
  return "rgb(" + Math.round(12-p*7) + "," + Math.round(46-p*31) + "," + Math.round(58-p*38) + ")";
}
/* unpack 1° land bitmask + ocean depth + monthly temperature bytes */
const bits = Uint8Array.from(atob(D.land.bits), (c) => c.charCodeAt(0));
const isLand = (i, j) => { const k = i*D.land.nLon + j; return (bits[k>>3] >> (7-(k&7))) & 1; };
const OD = Uint8Array.from(atob(D.oceanDepth), (c) => c.charCodeAt(0));
const TB = Int8Array.from(atob(D.monthlyTemp), (c) => c.charCodeAt(0));
const NL = D.land.nLat, NO = D.land.nLon;
const tempAt = (m,i,j) => { const v = TB[m*NL*NO + i*NO + j]; return v === -128 ? null : v; };
/* days-since-1970 → continuous month coordinate 0..12 (for smooth breathing) */
function monthCoord(day){
  const d = new Date(day*86400000), m = d.getUTCMonth();
  return m + (d.getUTCDate()-1)/DIM[m];
}

/* ---------- hero: a camera that flies to frame each animal ---------- */
const cv = document.getElementById("earth"), ctx = cv.getContext("2d");
const seasonCv = document.createElement("canvas"); const sctx = seasonCv.getContext("2d");
const LAT = 88;
let W2=0,H2=0,dpr=1,dots=[],sea=[];
/* camera = a lon/lat centre + how many degrees of longitude fill the width.
   Equirectangular is linear, so zoom is pure scale-and-pan — fast and smooth. */
let cam={lon:0,lat:12,span:360}, camFrom=cam, camTo=cam;
let flyRef={lon:0,lat:12,span:360}, plateKey="";      /* during a fly we transform one whole-world plate instead of re-plotting */
const wrap = (d) => ((d+540)%360)-180;
const ppd = () => W2/cam.span;                         /* pixels per degree */
const px = (lo) => W2/2 + wrap(lo-cam.lon)*ppd();
const py = (la) => H2/2 - (la-cam.lat)*ppd();
let builtKey="";
function buildDots(){
  dpr = Math.min(1.5, window.devicePixelRatio || 1);   /* 1.5 is plenty for a dot-matrix; halves fill-rate vs 2 on Retina */
  W2 = cv.clientWidth; H2 = cv.clientHeight;
  cv.width = W2*dpr; cv.height = H2*dpr;
  seasonCv.width = cv.width; seasonCv.height = cv.height;
  dots = []; sea = [];
  for (let i=0;i<NL;i++) for (let j=0;j<NO;j++){
    const la = -90+i+.5, lo = -180+j+.5;
    if (la > LAT || la < -LAT) continue;
    if (isLand(i,j)) dots.push([lo,la,i,j]);
    /* seabed on a 2° lattice (aligned to the land grid) — sparser & dimmer stipple */
    else if ((i&1)===0 && (j&1)===0){ const d = OD[i*NO+j]; if (d) sea.push([lo,la,d*30]); }
  }
  builtKey = "";
}
/* recolour + reproject the land dots for the current camera + month (culled) */
function buildSeason(mc){
  const m0 = Math.floor(mc)%12, m1 = (m0+1)%12, f = mc-Math.floor(mc);
  const r = Math.max(.5, Math.min(3.4, ppd()*.34)), m = r+2;
  sctx.setTransform(dpr,0,0,dpr,0,0); sctx.clearRect(0,0,W2,H2);
  /* seabed first, behind the land */
  const sr = Math.max(.5, Math.min(2.6, ppd()*.3));
  for (const [lo,la,dm] of sea){
    const x = px(lo); if (x < -m || x > W2+m) continue;
    const y = py(la); if (y < -m || y > H2+m) continue;
    sctx.fillStyle = oceanTint(dm);
    sctx.beginPath(); sctx.arc(x,y,sr,0,6.283); sctx.fill();
  }
  for (const [lo,la,i,j] of dots){
    const x = px(lo); if (x < -m || x > W2+m) continue;
    const y = py(la); if (y < -m || y > H2+m) continue;
    const a = tempAt(m0,i,j), b = tempAt(m1,i,j);
    const t = a===null ? b : b===null ? a : a+(b-a)*f;
    sctx.fillStyle = landTint(t);
    sctx.beginPath(); sctx.arc(x,y,r,0,6.283); sctx.fill();
  }
}
/* render the whole world into the season canvas at the fly's reference camera, so
   each fly frame is a cheap scale-and-pan of this one bitmap (the projection is
   linear). One rebuild per fly instead of ~30k dots every single frame. */
function buildPlate(mc){ const save = cam; cam = flyRef; buildSeason(mc); cam = save; builtKey = ""; }
let cur=0, prog=0, phase="fly", flyT=0, hold=0, raf=null, last=0;
function curDay(t){ return t.start + (t.end-t.start)*prog; }
/* target camera to frame a track's bounding box within the current aspect */
function target(t){
  const pad=1.45;
  /* floor of 85° so even a tightly-clustered animal (e.g. the arctic fox) keeps
     enough continent around it to be placeable on Earth. */
  const span = Math.max(85, Math.min(360, Math.max(t.cam.lonSpan*pad, t.cam.latSpan*pad*(W2/H2))));
  return { lon:t.cam.lon, lat:t.cam.lat, span };
}
const ease = (e)=> e<.5 ? 4*e*e*e : 1 - Math.pow(-2*e+2,3)/2;
function lerpCam(a,b,e){
  return { lon:a.lon + wrap(b.lon-a.lon)*e, lat:a.lat+(b.lat-a.lat)*e,
           span:Math.exp(Math.log(a.span)+(Math.log(b.span)-Math.log(a.span))*e) };
}
function drawTrack(t, upto, alpha){
  ctx.lineWidth=1.7; ctx.lineJoin="round"; ctx.lineCap="round"; ctx.shadowBlur=alpha>.5?10:0;
  for (let i=1;i<upto;i++){
    const a=t.pts[i-1], b=t.pts[i];
    const x1=px(a[0]), x2=px(b[0]);
    if (Math.abs(x2-x1) > W2*.6) continue;               /* wrapped across the far side — skip */
    const col=tcol(b[2],alpha); ctx.strokeStyle=col; ctx.shadowColor=col;
    ctx.beginPath(); ctx.moveTo(x1,py(a[1])); ctx.lineTo(x2,py(b[1])); ctx.stroke();
  }
  ctx.shadowBlur=0;
}
function render(){
  const t = D.tracks[cur]; if (!t) return;
  const mc = monthCoord(curDay(t));
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W2,H2);
  if (phase==="fly"){
    /* cheap path: one whole-world plate, scaled & panned (and tiled for the
       dateline wrap) to the moving camera. Arrive on empty land — no track yet. */
    const k = Math.round(mc*3)+"@"+Math.round(flyRef.lon)+"@"+W2+"x"+H2;
    if (k !== plateKey){ buildPlate(mc); plateKey = k; }
    const s = 360/cam.span, ppdB = W2/cam.span;
    const tx = W2/2*(1-s) + wrap(flyRef.lon - cam.lon)*ppdB;
    const ty = H2/2*(1-s) - (flyRef.lat - cam.lat)*ppdB;
    const pw = W2*s; let ox = tx; while (ox > 0) ox -= pw;
    for (; ox < W2; ox += pw){
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.translate(ox,ty); ctx.scale(s,s);
      ctx.drawImage(seasonCv, 0,0,W2,H2);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return;
  }
  const key = Math.round(cam.lon)+","+Math.round(cam.lat)+","+Math.round(cam.span*4)+","+Math.round(mc*3);
  if (key !== builtKey){ buildSeason(mc); builtKey = key; }
  ctx.drawImage(seasonCv, 0,0,W2,H2);
  const full = t.pts.length;
  {
    const upto = reduce ? full : phase==="hold" ? full : Math.floor(prog*full);
    drawTrack(t, upto, .92);                              /* bright, only what's been drawn */
    if (upto>0){
      const p=t.pts[Math.max(0,upto-1)], x=px(p[0]), y=py(p[1]);
      ctx.fillStyle="#fff"; ctx.shadowColor=tcol(p[2],1); ctx.shadowBlur=14;
      ctx.beginPath(); ctx.arc(x,y,2.6,0,6.283); ctx.fill(); ctx.shadowBlur=0;
      const d=new Date(curDay(t)*86400000);
      document.getElementById("hudDate").textContent = MONTHS[d.getUTCMonth()]+" "+d.getUTCFullYear();
      const nt=p[2]; document.getElementById("ribNow").textContent = nt===null?"—":(nt>0?"+":"")+nt+"°C";
      drawRibbon(upto);
    }
  }
}

/* ---------- temperature ribbon ---------- */
const rb = document.getElementById("ribbon"), rx = rb.getContext("2d");
let RW=0,RH=0;
function sizeRibbon(){ RW = rb.clientWidth; RH = 46; rb.width = RW*dpr; rb.height = RH*dpr; }
function drawRibbon(upto){
  const t = D.tracks[cur]; if (!t || !RW) return;
  const TLO=-25, THI=35;
  rx.setTransform(dpr,0,0,dpr,0,0); rx.clearRect(0,0,RW,RH);
  const X = (i) => (i/(t.pts.length-1))*RW;
  const Y = (v) => RH - ((v-TLO)/(THI-TLO))*RH;
  rx.strokeStyle = "rgba(110,140,148,.25)"; rx.lineWidth = 1;
  rx.beginPath(); rx.moveTo(0,Y(0)); rx.lineTo(RW,Y(0)); rx.stroke();
  rx.lineWidth = 2; rx.lineJoin = "round"; rx.lineCap = "round";
  for (let i=1;i<upto;i++){
    const a=t.pts[i-1][2], b=t.pts[i][2]; if (a===null||b===null) continue;
    rx.strokeStyle = tcol(b,.95);
    rx.beginPath(); rx.moveTo(X(i-1),Y(a)); rx.lineTo(X(i),Y(b)); rx.stroke();
  }
  if (upto>1){ const p = X(upto-1);
    rx.strokeStyle = "rgba(255,255,255,.5)"; rx.lineWidth = 1;
    rx.beginPath(); rx.moveTo(p,0); rx.lineTo(p,RH); rx.stroke(); }
}

function goTo(i, animate){
  cur = i;
  const t = D.tracks[i];
  document.getElementById("hudName").textContent = t.common;
  document.getElementById("hudKm").textContent = t.km.toLocaleString("en-US") + " km";
  document.getElementById("hudSub").textContent = t.days.toLocaleString("en-US") + " days · " + t.fixes.toLocaleString("en-US") + " fixes";
  [...document.querySelectorAll("#picker button")].forEach((b,k)=>b.setAttribute("aria-pressed", k===i?"true":"false"));
  /* announce the featured animal so a host app (the Next site) can offer a link to
     its full journey. A no-op in the standalone artifact (nobody listening). */
  try { dispatchEvent(new CustomEvent("hero:animal", { detail: { slug: t.slug, common: t.common } })); } catch (e) {}
  camTo = target(t);
  if (animate && !reduce){
    camFrom = cam; flyT = 0; phase = "fly";
    flyRef = { lon: camFrom.lon + wrap(camTo.lon - camFrom.lon)/2, lat: 12, span: 360 };
    plateKey = "";                                       /* rebuild the plate for this fly */
  }
  else { cam = camTo; prog = reduce?1:0; phase = reduce?"hold":"draw"; render(); }
}
const pick = document.getElementById("picker");
D.tracks.forEach((t,i)=>{
  const b = document.createElement("button");
  b.textContent = t.common; b.setAttribute("aria-pressed","false");
  b.onclick = ()=>{ goTo(i,true); if(!reduce) run(); };
  pick.appendChild(b);
});
const FLY=1.7, DRAW=5.5, HOLD=2;
function run(){
  cancelAnimationFrame(raf); last = 0;
  const frame = (ts)=>{
    if (!last) last = ts; const dt = (ts-last)/1000; last = ts;
    if (phase==="fly"){
      flyT += dt/FLY; const e = ease(Math.min(flyT,1)); cam = lerpCam(camFrom,camTo,e);
      if (flyT>=1){ cam = {...camTo}; phase="draw"; prog=0; }
    } else if (phase==="draw"){
      prog += dt/DRAW; if (prog>=1){ prog=1; render(); phase="hold"; hold=0; return void (raf=requestAnimationFrame(frame)); }
    } else if (phase==="hold"){
      hold += dt; if (hold>=HOLD){ goTo((cur+1)%D.tracks.length, true); }
    }
    render(); raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
function boot(){
  buildDots(); sizeRibbon();
  const t0 = D.tracks[0];
  cam = { lon:t0.cam.lon, lat:12, span:360 };            /* open on the whole world… */
  if (reduce){ goTo(0,false); }                          /* static: jump straight to framing */
  else { goTo(0,true); run(); }                          /* …then fly in to the first animal */
}
boot();
let rz; addEventListener("resize", ()=>{ clearTimeout(rz); rz = setTimeout(()=>{ buildDots(); sizeRibbon(); camTo = target(D.tracks[cur]); if(reduce||phase==="hold") cam = camTo; builtKey=""; render(); }, 150); });

/* ---------- ignorance map ---------- */
const ig = document.getElementById("ign");
function drawIgn(){
  const G = D.grid, w = ig.parentElement.clientWidth-2, cell = w/G.nLon, h = cell*G.nLat;
  const d = Math.min(2, window.devicePixelRatio || 1);
  ig.width = w*d; ig.height = h*d; ig.style.height = h+"px";
  const x = ig.getContext("2d"); x.setTransform(d,0,0,d,0,0); x.clearRect(0,0,w,h);
  for (let i=0;i<G.nLat;i++) for (let j=0;j<G.nLon;j++){
    const k=i*G.nLon+j, s=G.species[k], px=j*cell, py=(G.nLat-1-i)*cell;
    let fill=null;
    if (s>=20) fill=C("--warm"); else if (s>=8) fill=C("--cold");
    else if (s>=3) fill="rgba(88,210,230,.65)"; else if (s>=1) fill="rgba(88,210,230,.3)";
    else if (G.land[k]) fill=C("--land");
    if(!fill) continue;
    x.fillStyle=fill; x.fillRect(px,py,cell+.6,cell+.6);
  }
}
drawIgn(); addEventListener("resize", drawIgn);

/* ---------- thermal bands ---------- */
const BANDS = [
  { sci:"Onychoprion fuscatus", common:"sooty tern", lo:24.7, hi:28.1, band:3.4 },
  { sci:"Fulmarus glacialis", common:"northern fulmar", lo:1.2, hi:10.8, band:9.6 },
  { sci:"Thalassarche chrysostoma", common:"grey-headed albatross", lo:1.3, hi:11.4, band:10.1 },
  { sci:"Aptenodytes patagonicus", common:"king penguin", lo:-2.1, hi:8.4, band:10.5 },
  { sci:"Limosa lapponica", common:"bar-tailed godwit", lo:11.6, hi:31.2, band:19.6 },
];
const TLO=-5, THI=34;
document.getElementById("bands").innerHTML = BANDS.map((b)=>{
  const l = 100*(b.lo-TLO)/(THI-TLO), w = Math.max(1.5, 100*(b.hi-b.lo)/(THI-TLO));
  return '<div class="band"><div class="who"><em>'+b.sci+'</em><span>'+b.common+'</span></div>'
    + '<div class="rail"><i style="left:'+l+'%;width:'+w+'%;background:linear-gradient(90deg,'
    + tcol(b.lo,.95)+','+tcol(b.hi,.95)+')"></i></div>'
    + '<div class="v">'+b.band.toFixed(1)+'&deg;C</div></div>';
}).join("");
</script>`;

writeFileSync(R("landing.html"), html);
console.log(`✓ landing.html (${(html.length / 1024).toFixed(0)} KB) — breathing Earth, ${W.tracks.length} tracks`);
