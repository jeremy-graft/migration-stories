import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allJourneys, journeyBySlug, displayName, type JourneyMeta, type JourneyDetail } from "@/lib/journeys";
import Journey from "@/components/Journey";
import Provenance from "@/components/Provenance";
import SiteFooter from "@/components/SiteFooter";

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
  if (!j) return { title: "Journey · Where Animals Go" };
  return {
    title: `${cap(displayName(j))} · Where Animals Go`,
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
      <b className="statV">{v}</b>
      <span className="statK">{k}</span>
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthYear = (day: number) => {
  const d = new Date(day * 86400000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const lat = (v: number) => `${Math.abs(v).toFixed(0)}°${v < 0 ? "S" : "N"}`;
function duration(days: number): string {
  if (days < 75) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30.44)} months`;
  const y = Math.floor(days / 365), m = Math.round((days % 365) / 30.44);
  const yy = `${y} year${y > 1 ? "s" : ""}`;
  return m >= 1 && m <= 11 ? `${yy} and ${m} month${m > 1 ? "s" : ""}` : yy;
}

/**
 * Sentences about this animal, every one computed from its own track. Nothing here
 * is narrative invention: if a number isn't in the data, the sentence isn't shown.
 */
function facts(j: JourneyDetail, rankPct: number | null, total: number): string[] {
  const out: string[] = [];
  out.push(`Followed for ${duration(j.days)}, from ${monthYear(j.start)} to ${monthYear(j.end)}, across ${j.fixes.toLocaleString("en-US")} recorded positions.`);

  const hemi =
    j.latHi < 0 ? "never leaving the southern hemisphere"
    : j.latLo > 0 ? "never leaving the northern hemisphere"
    : j.crossings > 0 ? `crossing the equator ${j.crossings === 1 ? "once" : `${j.crossings} times`}`
    : "staying close to the equator";
  out.push(`It ranged between ${lat(j.latLo)} and ${lat(j.latHi)}, ${hemi}.`);

  if (j.tLo != null && j.tHi != null) {
    out.push(
      j.tHi - j.tLo <= 6
        ? `Remarkably, it stayed inside a narrow thermal band the whole time, between ${j.tLo}°C and ${j.tHi}°C.`
        : `The water and air it moved through ran from ${j.tLo}°C to ${j.tHi}°C.`,
    );
  }
  if (j.kmPerDay != null) out.push(`It averaged ${j.kmPerDay.toLocaleString("en-US")} km a day, every day, across the whole tracking period.`);

  if (j.endGapKm != null) {
    out.push(
      j.endGapKm <= 50
        ? `It finished within ${j.endGapKm} km of where it started, a round trip closed almost exactly.`
        : j.endGapKm <= 500
          ? `It finished ${j.endGapKm.toLocaleString("en-US")} km from where it started, roughly back in the same region.`
          : `Its last fix was ${j.endGapKm.toLocaleString("en-US")} km from its first, so the track we have is a one-way journey rather than a closed loop.`,
    );
  }
  // "more than 100% of them" is nonsense, so name the top of the list outright
  if (rankPct === 100) out.push(`No other animal in this catalog of ${total} species covered more ground.`);
  else if (rankPct != null && rankPct >= 50)
    out.push(`Of the ${total} species followed here, this animal covered more ground than ${rankPct}% of them.`);
  return out;
}

export default async function JourneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const j = journeyBySlug(slug);
  if (!j) notFound();
  const name = displayName(j);
  const others = related(slug, j.group);

  const all = allJourneys();
  const rankPct = all.length > 1 ? Math.round((all.filter((o) => o.km < j.km).length / (all.length - 1)) * 100) : null;
  const lines = facts(j, rankPct, all.length);

  return (
    <main className="page">
      <Link href="/" className="backLink">
        &larr; Where animals go
      </Link>

      <header className="pageHead">
        <p className="eyebrow">One real tracked animal{j.group ? ` · ${j.group}` : ""}</p>
        <h1 className="pageTitle">{cap(name)}</h1>
        {j.common ? <p className="pageSci">{j.sci}</p> : null}
      </header>

      <Journey slug={slug} />

      <p className="lede">{cap(human(j.note))}.</p>

      <div className="statRow">
        <Stat v={j.km.toLocaleString("en-US") + " km"} k="distance" />
        <Stat v={j.days.toLocaleString("en-US")} k="days tracked" />
        <Stat v={j.fixes.toLocaleString("en-US")} k="fixes" />
        {j.band != null ? <Stat v={j.band + "°C"} k="temperature range" /> : null}
      </div>

      <section className="story">
        <span className="footLabel">What the track shows</span>
        {lines.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </section>

      <Provenance attrib={j.attrib} />

      <nav className="related">
        <div className="relatedHead">
          <p className="eyebrow">{j.group ? `More ${j.group.toLowerCase()}` : "More journeys"}</p>
          <Link href="/explore" className="moreLink">
            All species &rarr;
          </Link>
        </div>
        <ul className="rows">
          {others.map((o) => (
            <li key={o.slug}>
              <Link href={`/journey/${o.slug}`} className="row">
                <span className="rowName">{cap(displayName(o))}</span>
                <span className="rowNum">{o.km.toLocaleString("en-US")} km</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <SiteFooter />
    </main>
  );
}
