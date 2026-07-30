"use client";
// A focused, EXPLORABLE view of one animal's journey: the dot-matrix Earth framed
// on its range, its track drawing itself across the seasons, and the temperature
// ribbon beneath. Shares the projection and colour maths with the landing hero
// (lib/earth-math) so it reads as the same instrument.
//
// Drag to pan, wheel or pinch to zoom, double-click to zoom in, keyboard arrows
// and +/- for the same. A graticule and a live coordinate readout answer the
// question the dots alone can't: where on Earth am I looking?
//
// Performance note: the Earth layer is expensive to plot (~30k dots) but the
// equirectangular projection is LINEAR, so during a gesture we scale-and-pan the
// cached bitmap instead of replotting, then redraw crisply once the gesture stops.
import { useEffect, useRef, useState } from "react";
import { wrap, tcol, landTint, oceanTint, monthCoord, MONTHS } from "@/lib/earth-math";

interface Cam { lon: number; lat: number; span: number }

export default function Journey({ slug }: { slug: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const rbRef = useRef<HTMLCanvasElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const tempRef = useRef<HTMLSpanElement>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const api = useRef<{ replay: () => void; zoom: (f: number) => void; reset: () => void }>({
    replay: () => {}, zoom: () => {}, reset: () => {},
  });
  const [moved, setMoved] = useState(false); // has the reader navigated away from the framing?

  useEffect(() => {
    const host = hostRef.current!, cv = cvRef.current!, rb = rbRef.current!;
    const ctx = cv.getContext("2d")!, rx = rb.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
    let raf = 0, cancelled = false, ro: ResizeObserver | null = null, settle: number | undefined;
    let onResize: (() => void) | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let track: any = null;
    let NL = 0, NO = 0;
    let bits = new Uint8Array(0), OD = new Uint8Array(0), TB = new Int8Array(0);
    let W2 = 0, H2 = 0, dpr = 1;
    let cam: Cam = { lon: 0, lat: 0, span: 360 };
    let home: Cam = cam;                       // the framing we open on, for "reset"
    let seasonCam: Cam | null = null;          // camera the cached Earth was plotted at
    let dots: number[][] = [], sea: number[][] = [];
    const seasonCv = document.createElement("canvas");
    const sctx = seasonCv.getContext("2d")!;
    let RW = 0; const RH = 56;
    let prog = 0, playing = false, last = 0;
    const DRAW = 8;
    const MIN_SPAN = 1.5, MAX_SPAN = 360;      // ~150 km across, to the whole world

    const isLand = (i: number, j: number) => { const k = i * NO + j; return (bits[k >> 3] >> (7 - (k & 7))) & 1; };
    const tempAt = (m: number, i: number, j: number) => { const v = TB[m * NL * NO + i * NO + j]; return v === -128 ? null : v; };
    const ppd = () => W2 / cam.span;
    const px = (lo: number) => W2 / 2 + wrap(lo - cam.lon) * ppd();
    const py = (la: number) => H2 / 2 - (la - cam.lat) * ppd();
    /** screen -> world, needed to zoom about the cursor */
    const lonAt = (x: number) => cam.lon + (x - W2 / 2) / ppd();
    const latAt = (y: number) => cam.lat - (y - H2 / 2) / ppd();

    function frameCamera(): Cam {
      const pad = 1.35, aspect = W2 / H2;
      const span = Math.max(70, Math.min(360, Math.max(track.cam.lonSpan * pad, track.cam.latSpan * pad * aspect)));
      return { lon: track.cam.lon, lat: track.cam.lat, span };
    }

    /** camera-independent: every dot we might ever draw, plotted once */
    function buildDots() {
      dots = []; sea = [];
      for (let i = 0; i < NL; i++) for (let j = 0; j < NO; j++) {
        const la = -90 + i + 0.5, lo = -180 + j + 0.5;
        if (la > 88 || la < -88) continue;
        if (isLand(i, j)) dots.push([lo, la, i, j]);
        else if ((i & 1) === 0 && (j & 1) === 0) { const d = OD[i * NO + j]; if (d) sea.push([lo, la, d * 30]); }
      }
    }

    function sizeCanvases() {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W2 = host.clientWidth; H2 = host.clientHeight;
      if (!W2 || !H2) return false;
      cv.width = W2 * dpr; cv.height = H2 * dpr; cv.style.width = W2 + "px"; cv.style.height = H2 + "px";
      seasonCv.width = cv.width; seasonCv.height = cv.height;
      RW = rb.clientWidth; rb.width = RW * dpr; rb.height = RH * dpr;
      return true;
    }

    /** plot the Earth at the CURRENT camera (the expensive path) */
    function buildSeason() {
      const midDay = track.pts[Math.floor(track.pts.length / 2)][3];
      const mc = monthCoord(midDay), m0 = Math.floor(mc) % 12, m1 = (m0 + 1) % 12, f = mc - Math.floor(mc);
      const r = Math.max(0.5, Math.min(3.4, ppd() * 0.34)), sr = Math.max(0.5, Math.min(2.6, ppd() * 0.3));
      const m = r + 3;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0); sctx.clearRect(0, 0, W2, H2);
      for (const [lo, la, dm] of sea) {
        const x = px(lo); if (x < -m || x > W2 + m) continue;
        const y = py(la); if (y < -m || y > H2 + m) continue;
        sctx.fillStyle = oceanTint(dm); sctx.beginPath(); sctx.arc(x, y, sr, 0, 6.283); sctx.fill();
      }
      for (const [lo, la, i, j] of dots) {
        const x = px(lo); if (x < -m || x > W2 + m) continue;
        const y = py(la); if (y < -m || y > H2 + m) continue;
        const a = tempAt(m0, i, j), b = tempAt(m1, i, j);
        const t = a === null ? b : b === null ? a : a + (b - a) * f;
        sctx.fillStyle = landTint(t); sctx.beginPath(); sctx.arc(x, y, r, 0, 6.283); sctx.fill();
      }
      seasonCam = { ...cam };
    }

    /** cheap: reuse the cached Earth, transformed to the current camera */
    function paintSeason() {
      if (!seasonCam) return;
      if (seasonCam.lon === cam.lon && seasonCam.lat === cam.lat && seasonCam.span === cam.span) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(seasonCv, 0, 0, W2, H2);
        return;
      }
      const s = seasonCam.span / cam.span, p = ppd();
      const tx = W2 / 2 - (s * W2) / 2 + wrap(seasonCam.lon - cam.lon) * p;
      const ty = H2 / 2 - (s * H2) / 2 - (seasonCam.lat - cam.lat) * p;
      const pw = W2 * s;
      let ox = tx; while (ox > 0) ox -= pw;               // tile for the dateline wrap
      for (; ox < W2; ox += pw) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(ox, ty); ctx.scale(s, s);
        ctx.drawImage(seasonCv, 0, 0, W2, H2);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** graticule: the reference the dots alone don't give you */
    function drawGrid() {
      const step = cam.span > 200 ? 30 : cam.span > 100 ? 20 : cam.span > 50 ? 10 : cam.span > 20 ? 5 : cam.span > 8 ? 2 : 1;
      ctx.lineWidth = 1; ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
      ctx.textBaseline = "middle";
      const lat0 = Math.ceil((cam.lat - H2 / 2 / ppd()) / step) * step;
      for (let la = lat0; la <= cam.lat + H2 / 2 / ppd(); la += step) {
        if (la < -90 || la > 90) continue;
        const y = py(la); if (y < 0 || y > H2) continue;
        const major = la === 0;
        ctx.strokeStyle = major ? "rgba(110,140,148,.4)" : "rgba(110,140,148,.14)";
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W2, y); ctx.stroke();
        ctx.fillStyle = major ? "rgba(140,175,184,.85)" : "rgba(110,140,148,.6)";
        ctx.textAlign = "left";
        ctx.fillText(la === 0 ? "0° equator" : `${Math.abs(la)}°${la < 0 ? "S" : "N"}`, 6, y - 7);
      }
      const lon0 = Math.ceil((cam.lon - cam.span / 2) / step) * step;
      for (let lo = lon0; lo <= cam.lon + cam.span / 2; lo += step) {
        const x = px(lo); if (x < 0 || x > W2) continue;
        const w = wrap(lo);
        ctx.strokeStyle = w === 0 ? "rgba(110,140,148,.4)" : "rgba(110,140,148,.14)";
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H2); ctx.stroke();
        ctx.fillStyle = "rgba(110,140,148,.6)"; ctx.textAlign = "center";
        ctx.fillText(w === 0 ? "0°" : `${Math.abs(w)}°${w < 0 ? "W" : "E"}`, x, H2 - 8);
      }
    }

    function drawTrack(upto: number) {
      ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (let i = 1; i < upto; i++) {
        const a = track.pts[i - 1], b = track.pts[i];
        const x1 = px(a[0]), x2 = px(b[0]);
        if (Math.abs(x2 - x1) > W2 * 0.6) continue;
        const col = tcol(b[2], 0.95); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(x1, py(a[1])); ctx.lineTo(x2, py(b[1])); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    function drawRibbon(upto: number) {
      const TLO = -25, THI = 35;
      rx.setTransform(dpr, 0, 0, dpr, 0, 0); rx.clearRect(0, 0, RW, RH);
      const X = (i: number) => (i / (track.pts.length - 1)) * RW, Y = (v: number) => RH - ((v - TLO) / (THI - TLO)) * RH;
      rx.strokeStyle = "rgba(110,140,148,.25)"; rx.lineWidth = 1;
      rx.beginPath(); rx.moveTo(0, Y(0)); rx.lineTo(RW, Y(0)); rx.stroke();
      rx.lineWidth = 2; rx.lineJoin = "round"; rx.lineCap = "round";
      for (let i = 1; i < upto; i++) {
        const a = track.pts[i - 1][2], b = track.pts[i][2]; if (a === null || b === null) continue;
        rx.strokeStyle = tcol(b, 0.95); rx.beginPath(); rx.moveTo(X(i - 1), Y(a)); rx.lineTo(X(i), Y(b)); rx.stroke();
      }
      if (upto > 1) {
        const p = X(upto - 1); rx.strokeStyle = "rgba(255,255,255,.5)"; rx.lineWidth = 1;
        rx.beginPath(); rx.moveTo(p, 0); rx.lineTo(p, RH); rx.stroke();
      }
    }
    const fmtPos = (lo: number, la: number) =>
      `${Math.abs(la).toFixed(1)}°${la < 0 ? "S" : "N"}  ${Math.abs(wrap(lo)).toFixed(1)}°${wrap(lo) < 0 ? "W" : "E"}`;

    function render() {
      if (!track || !W2) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W2, H2);
      paintSeason();
      drawGrid();
      const full = track.pts.length, upto = reduce ? full : Math.max(1, Math.floor(prog * full));
      drawTrack(upto);
      const p = track.pts[Math.min(full - 1, upto - 1)], x = px(p[0]), y = py(p[1]);
      ctx.fillStyle = "#fff"; ctx.shadowColor = tcol(p[2], 1); ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(x, y, 2.8, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
      const d = new Date(p[3] * 86400000);
      if (dateRef.current) dateRef.current.textContent = MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
      const nt = p[2];
      if (tempRef.current) tempRef.current.textContent = nt === null ? "—" : (nt > 0 ? "+" : "") + nt + "°C";
      if (posRef.current) posRef.current.textContent = fmtPos(p[0], p[1]);
      drawRibbon(upto);
    }

    /** redraw the Earth crisply once the reader stops moving */
    function scheduleSettle() {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { if (!cancelled && track) { buildSeason(); render(); } }, 140);
    }

    function loop(ts: number) {
      if (cancelled) return;
      if (!last) last = ts; const dt = (ts - last) / 1000; last = ts;
      if (playing) { prog += dt / DRAW; if (prog >= 1) { prog = 1; playing = false; } }
      render();
      if (playing) raf = requestAnimationFrame(loop);
    }
    function play() { cancelAnimationFrame(raf); prog = 0; playing = true; last = 0; raf = requestAnimationFrame(loop); }

    // ---------------- interaction ----------------
    const clampCam = () => {
      cam.span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, cam.span));
      const halfLat = H2 / 2 / ppd();
      cam.lat = Math.max(-90 + Math.min(halfLat, 89), Math.min(90 - Math.min(halfLat, 89), cam.lat));
      cam.lon = wrap(cam.lon);
    };
    const markMoved = () => setMoved(true);

    function zoomAbout(factor: number, cx: number, cy: number) {
      if (!track || !W2 || !H2) return;               // not laid out yet
      const lo = lonAt(cx), la = latAt(cy);
      cam.span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, cam.span * factor));
      // keep the point under the cursor fixed
      cam.lon = wrap(lo - (cx - W2 / 2) / ppd());
      cam.lat = la + (cy - H2 / 2) / ppd();
      clampCam(); markMoved(); render(); scheduleSettle();
    }

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0, dragged = false;

    const onPointerDown = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      cv.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!track || !W2) return;
      const prev = pointers.get(e.pointerId); if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && d > 0) {
          const r = cv.getBoundingClientRect();
          zoomAbout(pinchDist / d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        }
        pinchDist = d;
        return;
      }
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      cam.lon = wrap(cam.lon - dx / ppd());
      cam.lat = cam.lat + dy / ppd();
      clampCam(); markMoved(); render(); scheduleSettle();
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      cv.style.cursor = "grab";
      try { cv.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAbout(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    const onDblClick = (e: MouseEvent) => {
      if (dragged) return;
      const r = cv.getBoundingClientRect();
      zoomAbout(0.5, e.clientX - r.left, e.clientY - r.top);
    };
    const onKey = (e: KeyboardEvent) => {
      const panBy = (fx: number, fy: number) => {
        cam.lon = wrap(cam.lon + (fx * cam.span) / 8);
        cam.lat += (fy * cam.span * (H2 / W2)) / 8;
        clampCam(); markMoved(); render(); scheduleSettle();
      };
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); panBy(-1, 0); break;
        case "ArrowRight": e.preventDefault(); panBy(1, 0); break;
        case "ArrowUp": e.preventDefault(); panBy(0, 1); break;
        case "ArrowDown": e.preventDefault(); panBy(0, -1); break;
        case "+": case "=": e.preventDefault(); zoomAbout(0.7, W2 / 2, H2 / 2); break;
        case "-": case "_": e.preventDefault(); zoomAbout(1 / 0.7, W2 / 2, H2 / 2); break;
        case "0": e.preventDefault(); api.current.reset(); break;
      }
    };

    cv.addEventListener("pointerdown", onPointerDown);
    cv.addEventListener("pointermove", onPointerMove);
    cv.addEventListener("pointerup", onPointerUp);
    cv.addEventListener("pointercancel", onPointerUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("dblclick", onDblClick);
    cv.addEventListener("keydown", onKey);
    cv.style.cursor = "grab";
    cv.style.touchAction = "none";

    api.current.replay = () => { if (!reduce) play(); };
    api.current.zoom = (f) => zoomAbout(f, W2 / 2, H2 / 2);
    api.current.reset = () => { cam = { ...home }; setMoved(false); buildSeason(); render(); };

    Promise.all([
      fetch("/data/web.json").then((r) => r.json()),
      fetch(`/data/journey/${slug}.json`).then((r) => (r.ok ? r.json() : null)),
    ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(([D, J]: [any, any]) => {
        if (cancelled || !J) return;
        track = J;
        NL = D.land.nLat; NO = D.land.nLon;
        bits = Uint8Array.from(atob(D.land.bits), (c) => c.charCodeAt(0));
        OD = Uint8Array.from(atob(D.oceanDepth), (c) => c.charCodeAt(0));
        TB = Int8Array.from(atob(D.monthlyTemp), (c) => c.charCodeAt(0));
        buildDots();

        // The host can legitimately have no size yet (opened in a background tab,
        // late layout). Set the observer up FIRST and let it perform the first
        // frame, otherwise a zero-width mount leaves a permanently blank map with
        // nothing scheduled to recover it.
        let started = false;
        const ensureReady = () => {
          if (cancelled || !sizeCanvases()) return;
          if (!started) {
            started = true;
            cam = frameCamera(); home = { ...cam };
            buildSeason();
            if (reduce) render(); else play();
          } else {
            buildSeason(); render();
          }
        };
        ro = new ResizeObserver(ensureReady);
        ro.observe(host);
        addEventListener("resize", ensureReady);
        onResize = ensureReady;
        ensureReady();
      })
      .catch((e) => console.error("journey payload failed", e));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      if (ro) ro.disconnect();
      if (onResize) removeEventListener("resize", onResize);
      cv.removeEventListener("pointerdown", onPointerDown);
      cv.removeEventListener("pointermove", onPointerMove);
      cv.removeEventListener("pointerup", onPointerUp);
      cv.removeEventListener("pointercancel", onPointerUp);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("dblclick", onDblClick);
      cv.removeEventListener("keydown", onKey);
    };
  }, [slug]);

  return (
    <figure className="journeyFig">
      <div ref={hostRef} className="mapHost">
        <canvas ref={cvRef} className="mapCv" tabIndex={0} aria-label="Map of this animal's journey. Drag to pan, scroll to zoom, arrow keys and plus or minus also work." />
        <div className="mapRead">
          <div className="mapReadK">date</div>
          <span ref={dateRef} className="mapReadDate">&mdash;</span>
          <div className="mapReadK">temperature</div>
          <span ref={tempRef} className="mapReadTemp">&mdash;</span>
          <div className="mapReadK">position</div>
          <span ref={posRef} className="mapReadPos">&mdash;</span>
        </div>
        <div className="mapCtl">
          <button onClick={() => api.current.zoom(0.7)} aria-label="Zoom in">+</button>
          <button onClick={() => api.current.zoom(1 / 0.7)} aria-label="Zoom out">&minus;</button>
          {moved ? (
            <button className="mapCtlWide" onClick={() => api.current.reset()}>Fit journey</button>
          ) : null}
        </div>
      </div>
      <div className="ribbonRow">
        <canvas ref={rbRef} className="ribbonCv" />
        <button className="ghostBtn" onClick={() => api.current.replay()}>Replay</button>
      </div>
      <figcaption className="mapCap">
        colour = temperature the animal moved through &middot; drag to pan, scroll to zoom
      </figcaption>
    </figure>
  );
}
