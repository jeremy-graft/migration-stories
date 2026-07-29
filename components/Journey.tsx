"use client";
// A dedicated, focused view of ONE animal's journey: the dot-matrix Earth framed
// on its range, its track drawing itself across the seasons, and the temperature
// ribbon beneath. Shares the exact projection + colour math with the landing hero
// (lib/earth-math) so it looks like the same instrument. Reads /data/web.json.
import { useEffect, useRef } from "react";
import { wrap, tcol, landTint, oceanTint, monthCoord, MONTHS } from "@/lib/earth-math";

export default function Journey({ slug }: { slug: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const rbRef = useRef<HTMLCanvasElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const tempRef = useRef<HTMLSpanElement>(null);
  const replayRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Refs are guaranteed populated in a mount effect.
    const host = hostRef.current!, cv = cvRef.current!, rb = rbRef.current!;
    const ctx = cv.getContext("2d")!, rx = rb.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
    let raf = 0, cancelled = false, ro: ResizeObserver | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let track: any = null;
    let NL = 0, NO = 0;
    let bits = new Uint8Array(0), OD = new Uint8Array(0), TB = new Int8Array(0);
    let W2 = 0, H2 = 0, dpr = 1, cam = { lon: 0, lat: 0, span: 360 };
    let dots: number[][] = [], sea: number[][] = [];
    const seasonCv = document.createElement("canvas");
    const sctx = seasonCv.getContext("2d")!;
    let RW = 0; const RH = 56;
    let prog = 0, playing = false, last = 0;
    const DRAW = 8;

    const isLand = (i: number, j: number) => { const k = i * NO + j; return (bits[k >> 3] >> (7 - (k & 7))) & 1; };
    const tempAt = (m: number, i: number, j: number) => { const v = TB[m * NL * NO + i * NO + j]; return v === -128 ? null : v; };
    const ppd = () => W2 / cam.span;
    const px = (lo: number) => W2 / 2 + wrap(lo - cam.lon) * ppd();
    const py = (la: number) => H2 / 2 - (la - cam.lat) * ppd();

    function frameCamera() {
      const pad = 1.35, aspect = W2 / H2;
      const span = Math.max(70, Math.min(360, Math.max(track.cam.lonSpan * pad, track.cam.latSpan * pad * aspect)));
      cam = { lon: track.cam.lon, lat: track.cam.lat, span };
    }
    function build() {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W2 = host.clientWidth; H2 = host.clientHeight;
      cv.width = W2 * dpr; cv.height = H2 * dpr; cv.style.width = W2 + "px"; cv.style.height = H2 + "px";
      seasonCv.width = cv.width; seasonCv.height = cv.height;
      RW = rb.clientWidth; rb.width = RW * dpr; rb.height = RH * dpr;
      frameCamera();
      dots = []; sea = [];
      for (let i = 0; i < NL; i++) for (let j = 0; j < NO; j++) {
        const la = -90 + i + 0.5, lo = -180 + j + 0.5;
        if (la > 88 || la < -88) continue;
        const x = px(lo); if (x < -6 || x > W2 + 6) continue;
        const y = py(la); if (y < -6 || y > H2 + 6) continue;
        if (isLand(i, j)) dots.push([lo, la, i, j]);
        else if ((i & 1) === 0 && (j & 1) === 0) { const d = OD[i * NO + j]; if (d) sea.push([lo, la, d * 30]); }
      }
      buildSeason();
    }
    function buildSeason() {
      const midDay = track.pts[Math.floor(track.pts.length / 2)][3];
      const mc = monthCoord(midDay), m0 = Math.floor(mc) % 12, m1 = (m0 + 1) % 12, f = mc - Math.floor(mc);
      const r = Math.max(0.5, Math.min(3.4, ppd() * 0.34)), sr = Math.max(0.5, Math.min(2.6, ppd() * 0.3));
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0); sctx.clearRect(0, 0, W2, H2);
      for (const [lo, la, dm] of sea) {
        sctx.fillStyle = oceanTint(dm); sctx.beginPath(); sctx.arc(px(lo), py(la), sr, 0, 6.283); sctx.fill();
      }
      for (const [lo, la, i, j] of dots) {
        const a = tempAt(m0, i, j), b = tempAt(m1, i, j);
        const t = a === null ? b : b === null ? a : a + (b - a) * f;
        sctx.fillStyle = landTint(t); sctx.beginPath(); sctx.arc(px(lo), py(la), r, 0, 6.283); sctx.fill();
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
    function render() {
      if (!track) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W2, H2); ctx.drawImage(seasonCv, 0, 0, W2, H2);
      const full = track.pts.length, upto = reduce ? full : Math.max(1, Math.floor(prog * full));
      drawTrack(upto);
      const p = track.pts[Math.min(full - 1, upto - 1)], x = px(p[0]), y = py(p[1]);
      ctx.fillStyle = "#fff"; ctx.shadowColor = tcol(p[2], 1); ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(x, y, 2.8, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
      const d = new Date(p[3] * 86400000);
      if (dateRef.current) dateRef.current.textContent = MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
      const nt = p[2];
      if (tempRef.current) tempRef.current.textContent = nt === null ? "—" : (nt > 0 ? "+" : "") + nt + "°C";
      drawRibbon(upto);
    }
    function loop(ts: number) {
      if (cancelled) return;
      if (!last) last = ts; const dt = (ts - last) / 1000; last = ts;
      if (playing) { prog += dt / DRAW; if (prog >= 1) { prog = 1; playing = false; } }
      render();
      if (playing) raf = requestAnimationFrame(loop);
    }
    function play() { cancelAnimationFrame(raf); prog = 0; playing = true; last = 0; raf = requestAnimationFrame(loop); }
    replayRef.current = () => { if (!reduce) play(); };

    // The Earth grids come from the shared payload (cached across pages); the
    // animal's own track comes from its small per-journey file.
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
        build();
        if (reduce) render();
        else play();
        ro = new ResizeObserver(() => { build(); render(); });
        ro.observe(host);
      })
      .catch((e) => console.error("journey payload failed", e));

    return () => { cancelled = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); };
  }, [slug]);

  const mono = "var(--mono)";
  return (
    <figure style={{ margin: 0 }}>
      <div
        ref={hostRef}
        style={{
          position: "relative", width: "100%", height: "min(66vh, 580px)",
          background: "var(--void)", border: "1px solid var(--rule)", overflow: "hidden",
        }}
      >
        <canvas ref={cvRef} style={{ display: "block", width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", top: "1rem", right: "1rem", textAlign: "right", pointerEvents: "none", fontFamily: mono }}>
          <div style={{ fontSize: ".6rem", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)" }}>date</div>
          <span ref={dateRef} style={{ fontSize: "1rem", color: "var(--cold)" }}>&mdash;</span>
          <div style={{ fontSize: ".6rem", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)", marginTop: ".5rem" }}>temperature</div>
          <span ref={tempRef} style={{ fontSize: "1rem", color: "var(--warm)" }}>&mdash;</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: ".8rem" }}>
        <canvas ref={rbRef} style={{ flex: 1, height: "56px", display: "block", minWidth: 0 }} />
        <button
          onClick={() => replayRef.current()}
          style={{
            fontFamily: mono, fontSize: ".72rem", letterSpacing: ".08em", textTransform: "uppercase",
            background: "transparent", color: "var(--muted)", border: "1px solid var(--rule)",
            padding: ".5rem .9rem", cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          Replay
        </button>
      </div>
      <figcaption style={{ marginTop: ".6rem", fontFamily: mono, fontSize: ".66rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>
        colour = temperature the animal moved through
      </figcaption>
    </figure>
  );
}
