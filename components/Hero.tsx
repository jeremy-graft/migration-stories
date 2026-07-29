"use client";
// Mounts the generated "Where Animals Go" hero (canvas Earth + flying camera +
// findings). CSS, markup and logic all come from landing.html via
// scripts/gen-hero-component.ts, so this stays pixel-identical to the standalone
// artifact. The heavy payload is fetched from /data/web.json (cached, not bundled).
import { useEffect } from "react";
import { HERO_CSS, HERO_BODY, HERO_SCRIPT } from "./hero.generated";

declare global {
  interface Window {
    __heroRun?: (d: unknown) => void;
    __heroInit?: boolean;
  }
}

export default function Hero() {
  useEffect(() => {
    if (window.__heroInit) return; // guard React strict-mode double-invoke
    window.__heroInit = true;

    const style = document.createElement("style");
    style.textContent = HERO_CSS;
    document.head.appendChild(style);

    const script = document.createElement("script");
    script.textContent = HERO_SCRIPT; // defines window.__heroRun
    document.body.appendChild(script);

    fetch("/data/web.json")
      .then((r) => r.json())
      .then((d) => window.__heroRun?.(d))
      .catch((e) => console.error("hero payload failed to load", e));
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: HERO_BODY }} />;
}
