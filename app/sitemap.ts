import type { MetadataRoute } from "next";
import { statSync } from "node:fs";
import { join } from "node:path";
import { allJourneys } from "@/lib/journeys";

// Required for output:export — this route reads the filesystem, so Next needs
// telling that the result is baked at build time rather than per request.
export const dynamic = "force-static";

const BASE = "https://whereanimalsgo.com";

// lastmod is tied to the DATA, not the build clock. Rebuilding without changing
// anything would otherwise tell every crawler that all 323 pages just changed,
// which is both untrue and a good way to get re-crawled constantly.
const dataModified = statSync(join(process.cwd(), "public", "data", "journeys.json")).mtime;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: dataModified, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/explore`, lastModified: dataModified, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/findings`, lastModified: dataModified, changeFrequency: "monthly", priority: 0.8 },
    // One page per species. The tracks are historical, so they don't change once
    // published; saying "yearly" keeps crawlers from re-fetching them endlessly.
    ...allJourneys().map((j) => ({
      url: `${BASE}/journey/${j.slug}`,
      lastModified: dataModified,
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];
}
