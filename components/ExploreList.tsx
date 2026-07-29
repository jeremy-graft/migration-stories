"use client";
// The catalog: search + taxonomic-group filter over every species we can follow.
// Pure client filtering over the manifest passed from the server (no fetch).
import { useMemo, useState } from "react";
import Link from "next/link";

interface Row {
  slug: string;
  sci: string;
  common: string;
  group: string;
  km: number;
  days: number;
  fixes: number;
  license: string;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (r: Row) => r.common || r.sci;
const GROUPS = ["All", "Birds", "Mammals", "Reptiles", "Fish", "Other"];

export default function ExploreList({ journeys }: { journeys: Row[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("All");

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: journeys.length };
    for (const r of journeys) c[r.group] = (c[r.group] || 0) + 1;
    return c;
  }, [journeys]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return journeys.filter(
      (r) =>
        (group === "All" || r.group === group) &&
        (!needle || r.common.toLowerCase().includes(needle) || r.sci.toLowerCase().includes(needle)),
    );
  }, [journeys, q, group]);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: ".7rem", alignItems: "center", marginBottom: "1.4rem" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search species…"
          aria-label="Search species"
          style={{
            flex: "1 1 14rem", minWidth: 0, background: "var(--deep)", color: "var(--text)",
            border: "1px solid var(--rule)", padding: ".6rem .8rem", fontFamily: "var(--body)", fontSize: "1rem",
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
          {GROUPS.map((g) => {
            const on = g === group;
            return (
              <button
                key={g}
                onClick={() => setGroup(g)}
                aria-pressed={on}
                style={{
                  fontFamily: "var(--mono)", fontSize: ".68rem", letterSpacing: ".06em", textTransform: "uppercase",
                  cursor: "pointer", padding: ".42rem .7rem", border: "1px solid " + (on ? "var(--cold)" : "var(--rule)"),
                  background: on ? "var(--cold)" : "transparent", color: on ? "var(--void)" : "var(--muted)",
                }}
              >
                {g}
                {counts[g] ? ` ${counts[g]}` : ""}
              </button>
            );
          })}
        </div>
      </div>

      <p style={{ fontFamily: "var(--mono)", fontSize: ".7rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 1rem" }}>
        {shown.length} {shown.length === 1 ? "species" : "species"}
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(15rem,1fr))", gap: "1px", background: "var(--rule)", border: "1px solid var(--rule)" }}>
        {shown.map((r) => (
          <li key={r.slug}>
            <Link
              href={`/journey/${r.slug}`}
              style={{ display: "flex", flexDirection: "column", gap: ".25rem", background: "var(--deep)", padding: "1rem 1.1rem", textDecoration: "none", color: "var(--text)", height: "100%" }}
            >
              <span style={{ fontFamily: "var(--display)", fontSize: "1.05rem", lineHeight: 1.2 }}>{cap(label(r))}</span>
              {r.common ? <span style={{ fontStyle: "italic", fontFamily: "var(--display)", fontSize: ".82rem", color: "var(--muted)" }}>{r.sci}</span> : null}
              <span style={{ fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums", fontSize: ".8rem", color: "var(--warm)", marginTop: ".2rem" }}>
                {r.km.toLocaleString("en-US")} km
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: "1.5rem" }}>No species match &ldquo;{q}&rdquo;.</p>
      ) : null}
    </div>
  );
}
