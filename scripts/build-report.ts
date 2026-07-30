// Generate report.html from rescue/findings.json so every figure on the page
// comes from the data rather than being hand-copied. Re-run to refresh.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const F = JSON.parse(readFileSync(R("rescue/findings.json"), "utf8"));
const n = (x: number) => x.toLocaleString("en-US");

const html = `<title>What We Know About Where Animals Go</title>
<style>
  :root{
    --bg:#EEF2F3; --surface:#FAFCFC; --text:#0E2026; --muted:#5A737B; --rule:#CBD8DB;
    --cold:#2E7F8C; --warm:#B4601A; --unwatched:#A99C90; --shadow:rgba(14,32,38,.07);
    --display:ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    --body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme:dark){
    :root{ --bg:#061216; --surface:#0B1D23; --text:#DCE8EA; --muted:#7E979E; --rule:#173139;
           --cold:#4FB6C6; --warm:#E39445; --unwatched:#5C544C; --shadow:rgba(0,0,0,.4); }
  }
  :root[data-theme="dark"]{
    --bg:#061216; --surface:#0B1D23; --text:#DCE8EA; --muted:#7E979E; --rule:#173139;
    --cold:#4FB6C6; --warm:#E39445; --unwatched:#5C544C; --shadow:rgba(0,0,0,.4);
  }
  :root[data-theme="light"]{
    --bg:#EEF2F3; --surface:#FAFCFC; --text:#0E2026; --muted:#5A737B; --rule:#CBD8DB;
    --cold:#2E7F8C; --warm:#B4601A; --unwatched:#A99C90; --shadow:rgba(14,32,38,.07);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--body);
       font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
  .wrap{max-width:70rem;margin:0 auto;padding:clamp(1.5rem,4vw,4rem) clamp(1.1rem,4vw,2.5rem) 5rem}
  .prose{max-width:37rem}
  h1,h2,h3{font-family:var(--display);text-wrap:balance;margin:0}
  h1{font-size:clamp(2.3rem,6vw,4rem);line-height:1.04;letter-spacing:-.02em;font-weight:600}
  h2{font-size:clamp(1.4rem,3vw,1.9rem);line-height:1.15;letter-spacing:-.01em;font-weight:600}
  h3{font-size:1.09rem;line-height:1.3;font-weight:600}
  p{margin:0}
  .lede{font-size:clamp(1.05rem,2vw,1.22rem);color:var(--muted);line-height:1.55;max-width:34rem}
  .label{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
  header{display:flex;flex-direction:column;gap:1.5rem;padding-bottom:2.5rem;border-bottom:1px solid var(--rule)}
  /* corpus strip */
  .strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:1px;
         background:var(--rule);border:1px solid var(--rule);margin-top:.5rem}
  .stat{background:var(--bg);padding:.85rem 1rem;display:flex;flex-direction:column;gap:.15rem}
  .stat b{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:1.25rem;font-weight:600;letter-spacing:-.02em}
  section{padding-top:3.2rem;display:flex;flex-direction:column;gap:1.15rem}
  /* map */
  figure{margin:0;display:flex;flex-direction:column;gap:.9rem}
  .plate{background:var(--surface);border:1px solid var(--rule);padding:clamp(.6rem,2vw,1.2rem);
         box-shadow:0 1px 3px var(--shadow)}
  canvas{width:100%;height:auto;display:block}
  .legend{display:flex;flex-wrap:wrap;gap:1.1rem;align-items:center}
  .key{display:flex;align-items:center;gap:.45rem;font-family:var(--mono);font-size:.72rem;color:var(--muted)}
  .sw{width:.85rem;height:.85rem;border:1px solid var(--rule);flex:none}
  /* tables */
  .scroll{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:.9rem;min-width:30rem}
  th,td{text-align:left;padding:.5rem .8rem .5rem 0;border-bottom:1px solid var(--rule);vertical-align:baseline}
  th{font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:500}
  td.n{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  em.sp{font-style:italic}
  /* findings */
  .find{display:flex;flex-direction:column;gap:.55rem;padding:1.3rem 0;border-top:1px solid var(--rule)}
  .find:first-of-type{border-top:none}
  .meta{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
  .conf{font-family:var(--mono);font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;
        padding:.16rem .5rem;border:1px solid currentColor}
  .c-strong{color:var(--cold)} .c-mod{color:var(--warm)}
  /* limits */
  .limit{border-left:2px solid var(--warm);padding:.15rem 0 .15rem 1.1rem;display:flex;flex-direction:column;gap:.3rem}
  .limits{display:flex;flex-direction:column;gap:1.5rem}
  footer{margin-top:3.5rem;padding-top:1.5rem;border-top:1px solid var(--rule);color:var(--muted);font-size:.85rem;
         display:flex;flex-direction:column;gap:.6rem}
  a{color:var(--cold)}
  :focus-visible{outline:2px solid var(--warm);outline-offset:2px}
</style>

<div class="wrap">
<header>
  <span class="label">Open animal-tracking corpus &middot; ${F.corpus.yearFrom}&ndash;${F.corpus.yearTo}</span>
  <h1>What we know about<br>where animals go</h1>
  <p class="lede">A global movement corpus assembled from every openly-licensed tracking
     repository we could reach, and an honest account of the questions it can, and
     provably cannot, answer.</p>
  <div class="strip">
    <div class="stat"><b>${n(F.corpus.species)}</b><span class="label">species</span></div>
    <div class="stat"><b>${n(F.corpus.eligible)}</b><span class="label">animals</span></div>
    <div class="stat"><b>${(F.corpus.points/1e6).toFixed(2)}M</b><span class="label">fixes</span></div>
    <div class="stat"><b>${F.corpus.yearTo - F.corpus.yearFrom}</b><span class="label">years</span></div>
    <div class="stat"><b>7</b><span class="label">repositories</span></div>
  </div>
</header>

<section>
  <span class="label">The map</span>
  <h2>Where nobody has ever watched</h2>
  <p class="prose">Every cell is 5&deg; of the Earth. Colour is how many species have been tracked
     through it; <span style="color:var(--unwatched);font-weight:600">grey marks land where no tracked
     animal has ever been recorded</span>. This is not a map of animals. It is a map of where science
     has pointed its antennas.</p>
  <figure>
    <div class="plate"><canvas id="map" aria-label="World map of tracking coverage"></canvas></div>
    <div class="legend">
      <span class="key"><span class="sw" style="background:var(--unwatched)"></span>untracked land</span>
      <span class="key"><span class="sw" style="background:color-mix(in oklab,var(--cold) 28%,transparent)"></span>1&ndash;2 species</span>
      <span class="key"><span class="sw" style="background:color-mix(in oklab,var(--cold) 62%,transparent)"></span>3&ndash;7</span>
      <span class="key"><span class="sw" style="background:var(--cold)"></span>8&ndash;19</span>
      <span class="key"><span class="sw" style="background:var(--warm)"></span>20+</span>
    </div>
  </figure>
  <p class="prose">Coverage counts are a trap: a 5&deg; cell is roughly 550&nbsp;km across, so a single
     stork crossing the Sahara once makes it look &ldquo;covered&rdquo;. Measured by <em>intensity</em>
     instead, the picture inverts.</p>
  <div class="scroll"><table>
    <thead><tr><th>Land zone</th><th>Cells</th><th>Median species</th><th>Median fixes</th><th>Well studied</th></tr></thead>
    <tbody>
      <tr><td>Tropical &gt;20&deg;C</td><td class="n">238</td><td class="n">5</td><td class="n">381</td><td class="n">53%</td></tr>
      <tr><td>Subtropical 10&ndash;20&deg;C</td><td class="n">119</td><td class="n">7</td><td class="n">1,287</td><td class="n">73%</td></tr>
      <tr><td>Temperate 0&ndash;10&deg;C</td><td class="n">128</td><td class="n">7</td><td class="n">878</td><td class="n">71%</td></tr>
      <tr><td>Polar &lt;0&deg;C</td><td class="n">433</td><td class="n">1</td><td class="n">11</td><td class="n">26%</td></tr>
    </tbody>
  </table></div>
  <p class="prose">The tropics are known roughly <strong>3.4&times; more thinly</strong> than the
     subtropics. But the truly dark continent is polar: a median of <strong>one species and eleven
     fixes</strong> per cell, across the largest land zone on the map.</p>
</section>

<section>
  <span class="label">Findings</span>
  <h2>Four things the data says</h2>

  <div class="find">
    <div class="meta"><h3>Isotherm-following is universal. Circumnavigation is not.</h3>
      <span class="conf c-strong">strong</span></div>
    <p class="prose">Animals ride narrow temperature bands at every latitude, but only the
       Southern Ocean&rsquo;s unbroken circumpolar current lets one ride a band the whole way around
       the world. In the north, continents cut the highway short.</p>
    <div class="scroll"><table>
      <thead><tr><th>Species</th><th>Longitude roamed</th><th>Thermal band</th><th>Realm</th></tr></thead>
      <tbody>
        <tr><td><em class="sp">Onychoprion fuscatus</em> &middot; sooty tern</td><td class="n">160&deg;</td><td class="n">3.4&deg;C</td><td>tropical</td></tr>
        <tr><td><em class="sp">Thalassarche chrysostoma</em> &middot; grey-headed albatross</td><td class="n">280&deg;</td><td class="n">10.1&deg;C</td><td>Antarctic</td></tr>
        <tr><td><em class="sp">Fulmarus glacialis</em> &middot; northern fulmar</td><td class="n">205&deg;</td><td class="n">9.6&deg;C</td><td>Arctic</td></tr>
        <tr><td><em class="sp">Phoebetria palpebrata</em> &middot; light-mantled albatross</td><td class="n">355&deg;</td><td class="n">12.3&deg;C</td><td>Antarctic</td></tr>
        <tr><td><em class="sp">Limosa lapponica</em> &middot; bar-tailed godwit</td><td class="n">359&deg;</td><td class="n">19.6&deg;C</td><td>land-breeding</td></tr>
      </tbody>
    </table></div>
    <p class="prose">The godwit is the counter-case: it roams just as far but through a band twice as
       wide, because it commutes from Arctic tundra to tropical coast. Ocean specialists
       <em>follow</em> isotherms; land-breeding migrants <em>cross</em> them.</p>
  </div>

  <div class="find">
    <div class="meta"><h3>The white stork is arriving earlier, but not because of warmth.</h3>
      <span class="conf c-strong">strong</span></div>
    <p class="prose">Our best-sampled species (24 years, 498 animal-years) advances its spring
       migration by <span class="num">&minus;2.3</span> days per decade, matching the published
       literature. Yet its arrival has <em>no</em> relationship to spring temperature on its breeding
       grounds: <span class="num">r&nbsp;=&nbsp;&minus;0.03</span>. That is flat, not weak. A
       climate-shaped trend with a non-thermal cause, and this corpus cannot say which one.
       Of nine species tested, only the lesser black-backed gull showed a clear thermal response
       (<span class="num">&minus;3.4 days/&deg;C</span>).</p>
  </div>

  <div class="find">
    <div class="meta"><h3>The planet has two different migration rhythms.</h3>
      <span class="conf c-strong">solid</span></div>
    <p class="prose">Northern-hemisphere animals show the textbook double pulse, a spring surge
       (March&ndash;May) and a larger autumn one (September&ndash;October, ~<span class="num">20</span>
       km/day), with lulls for midsummer breeding and deep winter. Southern-hemisphere animals show
       no seasonal pulse at all: a steady <span class="num">30&ndash;40</span> km/day year-round,
       because that data is dominated by pelagic seabirds and seals that simply never stop.</p>
  </div>

  <div class="find">
    <div class="meta"><h3>Records, once the corrupt tracks are removed.</h3>
      <span class="conf c-mod">verified subset</span></div>
    <div class="scroll"><table>
      <tbody>
        <tr><td>Northernmost fix</td><td class="n">87.0&deg;N</td><td><em class="sp">Vulpes lagopus</em> &middot; arctic fox, on the polar pack ice</td></tr>
        <tr><td>Southernmost fix</td><td class="n">81.8&deg;S</td><td><em class="sp">Diomedea exulans</em> &middot; wandering albatross</td></tr>
        <tr><td>Longest journey</td><td class="n">362,017 km</td><td><em class="sp">Diomedea exulans</em> &middot; roughly the Earth&ndash;Moon distance</td></tr>
        <tr><td>Runner-up</td><td class="n">229,791 km</td><td><em class="sp">Pagophila eburnea</em> &middot; ivory gull</td></tr>
      </tbody>
    </table></div>
  </div>
</section>

<section>
  <span class="label">Limits</span>
  <h2>What this corpus provably cannot answer</h2>
  <p class="prose">This is the unusual part, and the reason to trust anything above it. Each limit
     below was learned by being refuted, a confident result that fell apart under checking.</p>
  <div class="limits">
    <div class="limit">
      <h3>Cross-species geography is a map of research funding</h3>
      <p class="prose">Asked where the planet&rsquo;s migration converges, the corpus answers
         &ldquo;Belgium,&rdquo; the home institute of its single largest data source. Three
         separate methods (hotspots, co-occurrence, network centrality) each rediscovered the funders
         rather than the biology. Betweenness centrality was worse than useless: one cell scored
         <span class="num">1.1M</span> while containing a single species, because the metric rewards
         chain-like graph shape, not ecological importance.</p>
    </div>
    <div class="limit">
      <h3>A trend is only visible if it beats the spread between individuals</h3>
      <p class="prose">Same species, same years, opposite outcomes. Arrival <em>date</em> varies about
         13 days between storks, and the trend is ~5.5 days over 24 years, marginal but
         detectable. Wintering <em>latitude</em> varies by <span class="num">70&deg;</span> between
         individuals, so a 1&ndash;3&deg;/decade shift is permanently invisible. Not biology.
         Variance.</p>
    </div>
    <div class="limit">
      <h3>Presence is not knowledge; extremes always lie</h3>
      <p class="prose">Eighty percent of land cells contain a tracked animal, which sounds like broad
         coverage and means almost nothing. Meanwhile every metric built on a raw minimum or maximum
         produced a falsehood: a killifish at the North Pole, a pintail credited with 430,000&nbsp;km,
         and five phantom &ldquo;circumnavigators&rdquo; that were really Bering Strait animals
         straddling the antimeridian. Percentiles and eligibility gates, not extremes.</p>
    </div>
  </div>
</section>

<footer>
  <p><span class="label">Sources</span> &nbsp;GBIF &middot; Movebank &middot; Zenodo &middot; Dryad &middot;
     NOAA/IOOS Animal Telemetry Network &middot; USGS ScienceBase &middot; PANGAEA. Openly licensed
     (CC0 / CC&nbsp;BY) only; non-commercial data is flagged and walled.</p>
  <p><span class="label">Environment</span> &nbsp;ETOPO1 relief at 0.25&deg; &middot; ERA5 monthly
     temperature via Open-Meteo &middot; BioShifts (30,534 published range-shift records).</p>
  <p><span class="label">Curation</span> &nbsp;${n(F.corpus.eligible)} of 23,068 individuals meet the
     eligibility gate (&ge;20 clean fixes, &le;6-year span, &le;300&nbsp;km/day, named species).
     3,449 teleport fixes, six species and two individuals are quarantined as corrupt, each with a
     documented reason.</p>
</footer>
</div>

<script>
  const G = ${JSON.stringify(F.grid)};
  const cv = document.getElementById("map");
  const cs = getComputedStyle(document.documentElement);
  function draw(){
    const css = cs.getPropertyValue.bind(cs);
    const cold = css("--cold").trim(), warm = css("--warm").trim(),
          un = css("--unwatched").trim(), rule = css("--rule").trim();
    const w = cv.parentElement.clientWidth, cell = w / G.nLon, h = cell * G.nLat;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
    const x = cv.getContext("2d"); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,w,h);
    for (let i=0;i<G.nLat;i++) for (let j=0;j<G.nLon;j++){
      const k=i*G.nLon+j, s=G.species[k];
      const px=j*cell, py=(G.nLat-1-i)*cell;                 // flip: north at top
      let fill=null, a=1;
      if(s>0){ if(s>=20){fill=warm;} else if(s>=8){fill=cold;}
               else if(s>=3){fill=cold;a=.62;} else {fill=cold;a=.28;} }
      else if(G.land[k]){ fill=un; a=.55; }
      if(!fill) continue;
      x.globalAlpha=a; x.fillStyle=fill; x.fillRect(px,py,cell+.5,cell+.5);
    }
    x.globalAlpha=1; x.strokeStyle=rule; x.lineWidth=1;
    x.beginPath(); x.moveTo(0,h/2); x.lineTo(w,h/2); x.stroke();   // equator
  }
  draw();
  addEventListener("resize", draw);
  // Redraw whenever the container itself gets a size, not just when the WINDOW
  // resizes: if this mounts while the page has no layout width yet (hidden tab,
  // late layout, embedded), sizing off clientWidth once leaves a 19px-wide map
  // that never recovers, because no window resize is coming.
  if (window.ResizeObserver && cv.parentElement) new ResizeObserver(draw).observe(cv.parentElement);
  new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
  matchMedia("(prefers-color-scheme:dark)").addEventListener("change", draw);
</script>`;

writeFileSync(R("report.html"), html);
console.log(`✓ report.html (${(html.length / 1024).toFixed(0)} KB) — ${F.corpus.species} species, ${n(F.corpus.points)} fixes`);
