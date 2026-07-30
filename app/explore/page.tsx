import type { Metadata } from "next";
import Link from "next/link";
import { allJourneys } from "@/lib/journeys";
import ExploreList from "@/components/ExploreList";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Explore every species · Where Animals Go",
  description:
    "Browse every animal we can follow: one real tracked individual per species, from open animal-tracking data.",
};

export default function ExplorePage() {
  const journeys = allJourneys();
  return (
    <main className="page page--wide">
      <Link href="/" className="backLink">
        &larr; Where animals go
      </Link>

      <header className="pageHead" style={{ maxWidth: "42rem" }}>
        <p className="eyebrow">The catalog</p>
        <h1 className="pageTitle">Every animal we can follow</h1>
        <p className="lede" style={{ marginTop: ".6rem" }}>
          {journeys.length} species, each shown through one real tracked individual, its longest clean journey.
          Every line is an animal that was really there.
        </p>
      </header>

      <ExploreList journeys={journeys} />
      <SiteFooter />
    </main>
  );
}
