// Track reconstruction: raw points -> cleaned, sorted, outlier-flagged track
// with distance, bbox, GeoJSON LineString, and a [lon,lat,ts] timeline for the
// render layer. Full resolution is preserved (outliers flagged, not dropped);
// a simplified copy is produced for rendering.

import * as turf from "@turf/turf";

export interface RawPoint {
  ts: string | Date | null | undefined;
  lon: number | null | undefined;
  lat: number | null | undefined;
}

export interface CleanPoint {
  ts: Date;
  lon: number;
  lat: number;
  visible: boolean; // false = flagged outlier (kept in DB, excluded from render/metrics)
}

export interface TrackResult {
  points: CleanPoint[];          // full resolution, sorted, outliers flagged
  bbox: [number, number, number, number]; // [minLon,minLat,maxLon,maxLat] of visible pts
  distanceKm: number;            // cumulative great-circle distance over visible pts
  latSpanDeg: number;            // bbox latitude span — a proxy for migratory amplitude
  trackStart: Date;
  trackEnd: Date;
  durationDays: number;
  pointCount: number;            // visible points
  geojson: GeoJSON.Feature<GeoJSON.LineString>;          // full-res visible line
  simplified: GeoJSON.Feature<GeoJSON.LineString>;       // render copy
  timeline: Array<[number, number, string]>;             // [lon, lat, ISO ts] visible
}

const isFiniteNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/**
 * Parse a timestamp, tolerating ISO 8601 intervals ("start/end") that many GBIF
 * datasets use for eventDate — we key on the start instant.
 */
function parseTimestamp(ts: string | Date): Date | null {
  if (ts instanceof Date) return ts;
  let s = ts;
  if (s.includes("/")) {
    const [a, b] = s.split("/");
    s = a || b; // prefer the start; fall back to end for "/end"
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Valid, non-null, non-(0,0) coordinate with a parseable timestamp. */
function toClean(p: RawPoint): CleanPoint | null {
  if (!isFiniteNum(p.lon) || !isFiniteNum(p.lat)) return null;
  if (p.lon === 0 && p.lat === 0) return null; // classic null-island artifact
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  if (!p.ts) return null;
  const ts = parseTimestamp(p.ts);
  if (!ts || Number.isNaN(ts.getTime())) return null;
  return { ts, lon: p.lon, lat: p.lat, visible: true };
}

/**
 * Thin a time-sorted point list to at most one fix per `minHours` window
 * (greedy: keep the first, skip until ≥minHours later, keep the next…). A
 * half-hourly GPS track becomes ~1–2 fixes/day — plenty to tell a migration
 * story, ~10× lighter. `minHours <= 0` is a no-op.
 */
export function thinByInterval<T extends { ts: Date }>(points: T[], minHours: number): T[] {
  if (minHours <= 0 || points.length === 0) return points;
  const minMs = minHours * 3_600_000;
  const out: T[] = [points[0]];
  let lastKept = points[0].ts.getTime();
  for (let i = 1; i < points.length; i++) {
    const t = points[i].ts.getTime();
    if (t - lastKept >= minMs) { out.push(points[i]); lastKept = t; }
  }
  return out;
}

/**
 * Reconstruct a single individual's track.
 * @param raw      raw points (any order)
 * @param maxSpeedKmh implausible-speed threshold for outlier flagging
 */
export function reconstructTrack(raw: RawPoint[], maxSpeedKmh = 120): TrackResult | null {
  const cleaned = raw
    .map(toClean)
    .filter((p): p is CleanPoint => p !== null)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // Collapse exact-duplicate timestamps (telemetry sometimes double-logs).
  const deduped: CleanPoint[] = [];
  for (const p of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.ts.getTime() === p.ts.getTime() && prev.lon === p.lon && prev.lat === p.lat) {
      continue;
    }
    deduped.push(p);
  }

  if (deduped.length < 2) return null;

  // Flag implausible jumps as not-visible. Measure speed against the last
  // VISIBLE point so a single teleport outlier doesn't poison the next good fix.
  let lastVisible = deduped[0];
  for (let i = 1; i < deduped.length; i++) {
    const b = deduped[i];
    const hours = (b.ts.getTime() - lastVisible.ts.getTime()) / 3_600_000;
    if (hours <= 0) { lastVisible = b; continue; }
    const km = turf.distance([lastVisible.lon, lastVisible.lat], [b.lon, b.lat], { units: "kilometers" });
    if (km / hours > maxSpeedKmh) b.visible = false;
    else lastVisible = b;
  }

  const visible = deduped.filter((p) => p.visible);
  if (visible.length < 2) return null;

  const coords: [number, number][] = visible.map((p) => [p.lon, p.lat]);
  const line = turf.lineString(coords);
  const bb = turf.bbox(line) as [number, number, number, number];
  const distanceKm = turf.length(line, { units: "kilometers" });
  const simplified = turf.simplify(line, { tolerance: 0.005, highQuality: true, mutate: false });

  const trackStart = visible[0].ts;
  const trackEnd = visible[visible.length - 1].ts;
  const durationDays = (trackEnd.getTime() - trackStart.getTime()) / 86_400_000;

  return {
    points: deduped,
    bbox: bb,
    distanceKm,
    latSpanDeg: bb[3] - bb[1],
    trackStart,
    trackEnd,
    durationDays,
    pointCount: visible.length,
    geojson: line,
    simplified,
    timeline: visible.map((p) => [p.lon, p.lat, p.ts.toISOString()]),
  };
}
