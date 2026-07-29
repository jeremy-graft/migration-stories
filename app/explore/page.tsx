import type { Metadata } from "next";
import Link from "next/link";
import { allJourneys } from "@/lib/journeys";
import ExploreList from "@/components/ExploreList";

export const metadata: Metadata = {
  title: "Explore every species · Where Animals Go",
  description:
    "Browse every animal we can follow: one real tracked individual per species, from open animal-tracking data.",
};

export default function ExplorePage() {
  const journeys = allJourneys();
  return (
    <main style={{ maxWidth: "72rem", margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem)" }}>
      <Link href="/" style={{ fontFamily: "var(--mono)", fontSize: ".72rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)", textDecoration: "none" }}>
        &larr; Where animals go
      </Link>

      <header style={{ margin: "1.6rem 0 2rem", maxWidth: "42rem" }}>
        <p style={{ fontFamily: "var(--mono)", fontSize: ".68rem", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)", margin: 0 }}>
          The catalog
        </p>
        <h1 style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: "clamp(2rem,5.5vw,3.4rem)", lineHeight: 1.03, letterSpacing: "-.02em", margin: ".4rem 0 .6rem" }}>
          Every animal we can follow
        </h1>
        <p style={{ fontSize: "1.05rem", color: "#b9cfd4", margin: 0 }}>
          {journeys.length} species, each shown through one real tracked individual, its longest clean journey.
          Every line is an animal that was really there.
        </p>
      </header>

      <ExploreList journeys={journeys} />
    </main>
  );
}
