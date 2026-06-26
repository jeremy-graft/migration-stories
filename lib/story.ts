// Draft story generation from a reconstructed track.
// Beats are FACTUAL and data-derived (dates, coordinates, distances, headings).
// We deliberately avoid inventing place names ("crossing the Sahara") we can't
// verify offline — editorial naming is a human pass, left for Jeremy.

import * as turf from "@turf/turf";
import type { TrackResult } from "./track";

export interface Beat {
  atTs: string;     // ISO timestamp this beat is keyed to
  lon: number;
  lat: number;
  heading: number;  // bearing (deg) toward travel at this point
  body: string;
}

const fmtDate = (d: Date) =>
  d.toISOString().slice(0, 10); // YYYY-MM-DD (timezone-stable)

const fmtCoord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;

function bearingAt(track: TrackResult, idx: number): number {
  const tl = track.timeline;
  const a = tl[Math.max(0, idx - 1)];
  const b = tl[Math.min(tl.length - 1, idx + 1)];
  if (a === b) return 0;
  return Math.round(turf.bearing([a[0], a[1]], [b[0], b[1]]));
}

/** Build a handful of factual beats keyed to real moments in the journey. */
export function generateBeats(track: TrackResult, displayName: string): Beat[] {
  const tl = track.timeline; // [lon, lat, iso]
  const n = tl.length;
  if (n < 2) return [];

  const beats: Beat[] = [];
  const push = (idx: number, body: string) => {
    const [lon, lat, iso] = tl[idx];
    beats.push({ atTs: iso, lon, lat, heading: bearingAt(track, idx), body });
  };

  // 1. Departure
  push(0, `Tracking begins. First fix at ${fmtCoord(tl[0][1], tl[0][0])} on ${fmtDate(track.trackStart)}.`);

  // 2. Northernmost & 3. southernmost extremes
  let nIdx = 0, sIdx = 0;
  for (let i = 1; i < n; i++) {
    if (tl[i][1] > tl[nIdx][1]) nIdx = i;
    if (tl[i][1] < tl[sIdx][1]) sIdx = i;
  }
  push(nIdx, `Northernmost point of the track — ${fmtCoord(tl[nIdx][1], tl[nIdx][0])}, ${fmtDate(new Date(tl[nIdx][2]))}.`);
  push(sIdx, `Southernmost point of the track — ${fmtCoord(tl[sIdx][1], tl[sIdx][0])}, ${fmtDate(new Date(tl[sIdx][2]))}.`);

  // 4. Longest single leg (biggest displacement between consecutive fixes)
  let legIdx = 1, legKm = 0;
  for (let i = 1; i < n; i++) {
    const km = turf.distance([tl[i - 1][0], tl[i - 1][1]], [tl[i][0], tl[i][1]], { units: "kilometers" });
    if (km > legKm) { legKm = km; legIdx = i; }
  }
  push(legIdx, `The longest single leg: ${Math.round(legKm)} km between ${fmtDate(new Date(tl[legIdx - 1][2]))} and ${fmtDate(new Date(tl[legIdx][2]))}.`);

  // 5. Arrival
  push(n - 1, `The track ends at ${fmtCoord(tl[n - 1][1], tl[n - 1][0])} on ${fmtDate(track.trackEnd)}.`);

  // Chronological order, de-duplicated by timestamp.
  const seen = new Set<string>();
  return beats
    .sort((a, b) => a.atTs.localeCompare(b.atTs))
    .filter((b) => (seen.has(b.atTs) ? false : (seen.add(b.atTs), true)));
}

/** URL-safe slug from a display name + scientific name. */
export function makeSlug(displayName: string, scientificName: string): string {
  return `${displayName}-${scientificName}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}
