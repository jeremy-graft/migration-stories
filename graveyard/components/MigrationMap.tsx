"use client";
// MapLibre map that draws the track up to `progress` (0..1). The faint full
// route is always shown; the bright portion advances. Source APIs are never
// called — coordinates come from props (our cached artifact).
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

type LonLatTs = [number, number, string];

export interface MigrationMapProps {
  timeline: LonLatTs[];
  bbox: [number, number, number, number];
  progress: number; // 0..1
}

const MAPTILER = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const STYLE = MAPTILER
  ? `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER}`
  : "https://demotiles.maplibre.org/style.json"; // free fallback, no key

export function MigrationMap({ timeline, bbox, progress }: MigrationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const readyRef = useRef(false);

  // Init once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE,
        bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        fitBoundsOptions: { padding: 48 },
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.on("load", () => {
        const coords = timeline.map((t) => [t[0], t[1]]);
        map.addSource("track-full", { type: "geojson", data: lineFeature(coords) });
        map.addSource("track-progress", { type: "geojson", data: lineFeature(coords.slice(0, 1)) });
        map.addSource("track-head", { type: "geojson", data: pointFeature(coords[0]) });

        map.addLayer({
          id: "track-full", type: "line", source: "track-full",
          paint: { "line-color": "#5b6b7a", "line-width": 1.2, "line-opacity": 0.5 },
        });
        map.addLayer({
          id: "track-progress", type: "line", source: "track-progress",
          paint: { "line-color": "#e8a0b0", "line-width": 2.4 },
        });
        map.addLayer({
          id: "track-head", type: "circle", source: "track-head",
          paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#e8a0b0", "circle-stroke-width": 2 },
        });
        readyRef.current = true;
        draw(map, coords, progress);
      });
    })();
    return () => { cancelled = true; mapRef.current?.remove(); readyRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw on progress change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    draw(map, timeline.map((t) => [t[0], t[1]]), progress);
  }, [progress, timeline]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} aria-label="Migration map" />;
}

function lineFeature(coords: number[][]) {
  return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } };
}
function pointFeature(coord: number[]) {
  return { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: coord } };
}
function draw(map: any, coords: number[][], progress: number) {
  const n = coords.length;
  if (n < 2) return;
  const idx = Math.max(1, Math.min(n, Math.round(progress * (n - 1)) + 1));
  map.getSource("track-progress")?.setData(lineFeature(coords.slice(0, idx)));
  map.getSource("track-head")?.setData(pointFeature(coords[idx - 1]));
}
