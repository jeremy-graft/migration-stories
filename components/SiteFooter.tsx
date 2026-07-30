// The footer the landing page always had, now on every page: sources, environment
// layers, and the curation caveat. Leaving a journey page shouldn't mean losing
// sight of where any of this came from.
import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="siteFooter">
      <p>
        <span className="footLabel">Sources</span> GBIF &middot; Movebank &middot; Zenodo &middot; Dryad &middot;
        NOAA/IOOS Animal Telemetry Network &middot; USGS ScienceBase &middot; PANGAEA, all openly licensed
        (CC0 / CC&nbsp;BY / CC&nbsp;BY-NC). Each journey names its own dataset and licence.
      </p>
      <p>
        <span className="footLabel">Environment</span> ETOPO1 relief &middot; ERA5 monthly temperature via Open-Meteo.
      </p>
      <p>
        <Link href="/explore">All species</Link> &middot; <Link href="/findings">Findings and limits</Link> &middot;{" "}
        <Link href="/">Home</Link>
      </p>
    </footer>
  );
}
