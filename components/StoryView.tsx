"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Attribution, type AttributionProps } from "./Attribution";

const MigrationMap = dynamic(() => import("./MigrationMap").then((m) => m.MigrationMap), { ssr: false });

export interface Beat { atTs: string; lon: number; lat: number; heading: number; body: string }

export interface StoryViewProps {
  title: string;
  dek?: string | null;
  timeline: [number, number, string][];
  bbox: [number, number, number, number];
  beats: Beat[];
  attribution: AttributionProps;
}

const DURATION_MS = 14000;

export function StoryView({ title, dek, timeline, bbox, beats, attribution }: StoryViewProps) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const reduced = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Reduced motion: draw the whole route immediately, no autoplay.
  useEffect(() => {
    if (reduced) { setProgress(1); return; }
    setPlaying(true);
  }, [reduced]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    startRef.current = 0;
    const tick = (now: number) => {
      if (!startRef.current) startRef.current = now - progress * DURATION_MS;
      const p = Math.min(1, (now - startRef.current) / DURATION_MS);
      setProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Map each beat to a progress fraction by its timestamp.
  const beatFractions = useMemo(() => {
    const n = timeline.length;
    return beats.map((b) => {
      let lo = 0;
      for (let i = 0; i < n; i++) { if (timeline[i][2] <= b.atTs) lo = i; else break; }
      return n > 1 ? lo / (n - 1) : 0;
    });
  }, [beats, timeline]);

  const currentIso = timeline[Math.min(timeline.length - 1, Math.round(progress * (timeline.length - 1)))]?.[2];
  const activeBeat = (() => {
    let idx = 0;
    for (let i = 0; i < beats.length; i++) if (beats[i].atTs <= (currentIso ?? "")) idx = i;
    return idx;
  })();

  const jumpTo = (frac: number) => { setPlaying(false); setProgress(frac); };

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 36, lineHeight: 1.1, margin: 0 }}>{title}</h1>
        {dek ? <p style={{ opacity: 0.75, fontSize: 16, margin: "8px 0 0" }}>{dek}</p> : null}
      </header>

      <div style={{ position: "relative", height: "58vh", minHeight: 360, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
        <MigrationMap timeline={timeline} bbox={bbox} progress={progress} />
      </div>

      {/* Scrub + play controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0 4px" }}>
        <button
          onClick={() => { if (progress >= 1) setProgress(0); setPlaying((v) => !v); }}
          aria-label={playing ? "Pause" : "Play"}
          style={{ background: "#1c2330", color: "#e6e8eb", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}
        >
          {playing ? "Pause" : progress >= 1 ? "Replay" : "Play"}
        </button>
        <input
          type="range" min={0} max={1} step={0.001} value={progress}
          onChange={(e) => jumpTo(Number(e.target.value))}
          aria-label="Scrub the journey" style={{ flex: 1 }}
        />
        <code style={{ fontSize: 12, opacity: 0.7, minWidth: 92, textAlign: "right" }}>
          {currentIso ? currentIso.slice(0, 10) : ""}
        </code>
      </div>

      {/* Beats */}
      <ol style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 8 }}>
        {beats.map((b, i) => (
          <li key={b.atTs + i}>
            <button
              onClick={() => jumpTo(beatFractions[i])}
              style={{
                textAlign: "left", width: "100%", cursor: "pointer",
                background: i === activeBeat ? "#222c3a" : "transparent",
                color: "#e6e8eb", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                padding: "10px 12px", transition: "background 120ms",
              }}
            >
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, opacity: 0.6 }}>
                {b.atTs.slice(0, 10)}
              </span>
              <div style={{ fontSize: 15, marginTop: 2 }}>{b.body}</div>
            </button>
          </li>
        ))}
      </ol>

      <Attribution {...attribution} />
    </main>
  );
}
