// Server-only: reads the catalog the export pipeline produced.
//   • journeys.json          — the manifest (one row per species) for lists + params
//   • journey/<slug>.json     — one animal's full detail, for its page
// The client <Journey/> fetches the per-animal file itself for the track points.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface JourneyMeta {
  slug: string;
  sci: string;
  common: string; // may be "" if GBIF had no English name; UI falls back to sci
  group: string; // Birds | Mammals | Reptiles | Fish | Other | ""
  km: number;
  days: number;
  fixes: number;
  band: number | null;
  license: string; // CC0_1_0 | CC_BY_4_0 | CC_BY_NC_4_0 | OTHER
  spark: string; // SVG path of the real track, normalised to a 100x60 box
  tmid: number | null; // median temperature experienced, drives the card colour
}
export interface JourneyDetail extends JourneyMeta {
  note: string;
  /** true when positions are displaced because the species is poached or persecuted */
  blurred?: boolean;
  // derived facts the journey page states in prose (all computed, never invented)
  latLo: number;
  latHi: number;
  tLo: number | null;
  tHi: number | null;
  kmPerDay: number | null;
  endGapKm: number | null;
  crossings: number;
  attrib: {
    source: string;
    title: string;
    doi: string | null;
    license: string;
    citation: string | null;
    publisher: string | null;
  } | null;
  cam: { lon: number; lat: number; lonSpan: number; latSpan: number };
  start: number;
  end: number;
}

const dataDir = join(process.cwd(), "public", "data");
let manifest: JourneyMeta[] | null = null;

export function allJourneys(): JourneyMeta[] {
  if (!manifest) manifest = JSON.parse(readFileSync(join(dataDir, "journeys.json"), "utf8"));
  return manifest!;
}

export function journeyBySlug(slug: string): JourneyDetail | undefined {
  const f = join(dataDir, "journey", `${slug}.json`);
  if (!existsSync(f)) return undefined;
  const d = JSON.parse(readFileSync(f, "utf8"));
  const { pts, ...rest } = d; // drop the heavy point array — the client fetches it
  void pts;
  return rest as JourneyDetail;
}

/** display label: common name if we have one, else the scientific name */
export const displayName = (j: { common: string; sci: string }) => j.common || j.sci;
