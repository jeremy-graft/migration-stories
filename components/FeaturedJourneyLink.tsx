"use client";
// Listens for the hero's "hero:animal" broadcast and offers a link to the
// currently-featured animal's full journey, plus the catalog. Updates as the
// montage cycles.
//
// Rendered via a PORTAL into the hero element rather than as a sibling. The hero's
// generated markup contains the findings sections and footer too, so a sibling in
// normal flow landed at the very bottom of the page. Inside `.hero` it can be
// absolutely placed against the hero on desktop and sit in flow at the foot of the
// hero on mobile, where there is no free space to float over.
//
// Plain <a>, not <Link>, on purpose: the hero injects a one-shot script guarded by
// window.__heroInit, so leaving home must be a real navigation.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function FeaturedJourneyLink() {
  const [animal, setAnimal] = useState<{ slug: string; common: string } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>(".hero"));
    const onAnimal = (e: Event) => {
      const d = (e as CustomEvent<{ slug: string; common: string }>).detail;
      if (d?.slug) setAnimal({ slug: d.slug, common: d.common });
    };
    addEventListener("hero:animal", onAnimal as EventListener);
    return () => removeEventListener("hero:animal", onAnimal as EventListener);
  }, []);

  const nav = (
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

  // Before the hero exists (or if its markup ever changes), fall back to rendering
  // in place rather than dropping the links entirely.
  return host ? createPortal(nav, host) : nav;
}
