"use client";
// Mounts the generated findings report (the ignorance map + the findings and their
// limits). CSS, markup and the map's canvas script all come from report.html via
// scripts/gen-report-component.ts, so this page and the standalone report stay
// identical in substance and can't drift.
import { useEffect } from "react";
import { REPORT_CSS, REPORT_BODY, REPORT_SCRIPT } from "./report.generated";

declare global {
  interface Window {
    __reportRun?: () => void;
    __reportInit?: boolean;
  }
}

export default function Findings() {
  useEffect(() => {
    if (window.__reportInit) return; // guard React strict-mode double-invoke
    window.__reportInit = true;

    const style = document.createElement("style");
    style.textContent = REPORT_CSS;
    document.head.appendChild(style);

    const script = document.createElement("script");
    script.textContent = REPORT_SCRIPT; // defines window.__reportRun
    document.body.appendChild(script);
    window.__reportRun?.();
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: REPORT_BODY }} />;
}
