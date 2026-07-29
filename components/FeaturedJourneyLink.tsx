"use client";
// Listens for the hero's "hero:animal" broadcast and offers a link to the
// currently-featured animal's full journey. Updates as the montage cycles.
// Uses a plain <a> (full navigation) on purpose: the hero injects a one-shot
// script that can't be re-initialised, so leaving home must be a real page load.
import { useEffect, useState } from "react";

export default function FeaturedJourneyLink() {
  const [animal, setAnimal] = useState<{ slug: string; common: string } | null>(null);

  useEffect(() => {
    const onAnimal = (e: Event) => {
      const d = (e as CustomEvent<{ slug: string; common: string }>).detail;
      if (d?.slug) setAnimal({ slug: d.slug, common: d.common });
    };
    addEventListener("hero:animal", onAnimal as EventListener);
    return () => removeEventListener("hero:animal", onAnimal as EventListener);
  }, []);

  return (
    <nav className="heroNav">
      {animal ? (
        <a className="journeyLink" href={`/journey/${animal.slug}`}>
          Follow the {animal.common} &rarr;
        </a>
      ) : null}
      <a className="journeyLink journeyLink--quiet" href="/explore">
        Explore all species &rarr;
      </a>
    </nav>
  );
}
