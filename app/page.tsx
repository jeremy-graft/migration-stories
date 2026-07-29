// Home: the "Where Animals Go" landing — the dot-matrix Earth, the flying camera,
// and the findings. Static (no database): the hero reads /data/web.json, generated
// offline by the export pipeline. A live link follows the featured animal into its
// full journey page.
import Hero from "@/components/Hero";
import FeaturedJourneyLink from "@/components/FeaturedJourneyLink";

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeaturedJourneyLink />
    </>
  );
}
