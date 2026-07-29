import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allJourneys, journeyBySlug, displayName, type JourneyMeta } from "@/lib/journeys";
import Journey from "@/components/Journey";

// Prerender one static page per species in the catalog.
export function generateStaticParams() {
  return allJourneys().map((j) => ({ slug: j.slug }));
}
export const dynamicParams = false;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// User-facing copy stays human: no em dashes (drop them for a comma).
const human = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const j = journeyBySlug(slug);
  if (!j) return { title: "Journey — Where Animals Go" };
  return {
    title: `${cap(displayName(j))} — Where Animals Go`,
    description: `${cap(human(j.note))}. ${j.km.toLocaleString("en-US")} km tracked across ${j.days.toLocaleString("en-US")} days.`,
  };
}

// A few kindred journeys to surface at the foot of the page: same taxonomic group,
// longest first, then the catalog link for the rest.
function related(slug: string, group: string): JourneyMeta[] {
  const all = allJourneys();
  const same = all.filter((o) => o.slug !== slug && o.group === group).sort((a, z) => z.km - a.km);
  const pool = same.length >= 5 ? same : all.filter((o) => o.slug !== slug).sort((a, z) => z.km - a.km);
  return pool.slice(0, 6);
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div>
      <b style={{ display: "block", fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums", fontSize: "clamp(1.2rem,2.6vw,1.7rem)", fontWeight: 600, letterSpacing: "-.02em" }}>{v}</b>
      <span style={{ fontFamily: "var(--mono)", fontSize: ".66rem", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)" }}>{k}</span>
    </div>
  );
}

export default async function JourneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const j = journeyBySlug(slug);
  if (!j) notFound();
  const name = displayName(j);
  const others = related(slug, j.group);

  return (
    <main style={{ maxWidth: "64rem", margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem)" }}>
      <Link href="/" style={{ fontFamily: "var(--mono)", fontSize: ".72rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)", textDecoration: "none" }}>
        &larr; Where animals go
      </Link>

      <header style={{ margin: "1.6rem 0 1.4rem" }}>
        <p style={{ fontFamily: "var(--mono)", fontSize: ".68rem", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)", margin: 0 }}>
          One real tracked animal{j.group ? ` · ${j.group}` : ""}
        </p>
        <h1 style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: "clamp(2rem,5.5vw,3.4rem)", lineHeight: 1.03, letterSpacing: "-.02em", margin: ".4rem 0 .3rem" }}>
          {cap(name)}
        </h1>
        {j.common ? <p style={{ fontStyle: "italic", fontFamily: "var(--display)", fontSize: "1.15rem", color: "var(--muted)", margin: 0 }}>{j.sci}</p> : null}
      </header>

      <Journey slug={slug} />

      <p style={{ maxWidth: "38rem", marginTop: "1.7rem", fontSize: "1.05rem", color: "#b9cfd4" }}>{cap(human(j.note))}.</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(1.2rem,4vw,3rem)", borderTop: "1px solid var(--rule)", marginTop: "1.6rem", paddingTop: "1.3rem" }}>
        <Stat v={j.km.toLocaleString("en-US") + " km"} k="distance" />
        <Stat v={j.days.toLocaleString("en-US")} k="days tracked" />
        <Stat v={j.fixes.toLocaleString("en-US")} k="fixes" />
        {j.band != null ? <Stat v={j.band + "°C"} k="temperature range" /> : null}
      </div>

      <nav style={{ borderTop: "1px solid var(--rule)", marginTop: "2.5rem", paddingTop: "1.3rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", margin: "0 0 .8rem" }}>
          <p style={{ fontFamily: "var(--mono)", fontSize: ".66rem", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)", margin: 0 }}>
            {j.group ? `More ${j.group.toLowerCase()}` : "More journeys"}
          </p>
          <Link href="/explore" style={{ fontFamily: "var(--mono)", fontSize: ".66rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--cold)", textDecoration: "none" }}>
            All species &rarr;
          </Link>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "1px", background: "var(--rule)", border: "1px solid var(--rule)" }}>
          {others.map((o) => (
            <li key={o.slug}>
              <Link href={`/journey/${o.slug}`} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", background: "var(--deep)", padding: "1rem 1.2rem", textDecoration: "none", color: "var(--text)" }}>
                <span style={{ fontFamily: "var(--display)" }}>{cap(displayName(o))}</span>
                <span style={{ fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums", color: "var(--warm)", whiteSpace: "nowrap" }}>{o.km.toLocaleString("en-US")} km</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
