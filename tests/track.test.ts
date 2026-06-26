import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructTrack, type RawPoint } from "../lib/track";

function northwardTrack(): RawPoint[] {
  const pts: RawPoint[] = [];
  for (let i = 0; i < 10; i++) {
    pts.push({ ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), lat: 40 + i, lon: 5 });
  }
  return pts;
}

test("reconstructTrack sorts, measures distance and bbox", () => {
  const shuffled = northwardTrack().reverse(); // out of order on purpose
  const t = reconstructTrack(shuffled);
  assert.ok(t);
  assert.equal(t!.pointCount, 10);
  assert.ok(t!.distanceKm > 900 && t!.distanceKm < 1200); // ~9° lat ≈ 1000 km
  assert.equal(t!.bbox[1], 40); // minLat
  assert.equal(t!.bbox[3], 49); // maxLat
  assert.ok(t!.latSpanDeg === 9);
  assert.ok(t!.trackStart.getTime() < t!.trackEnd.getTime());
});

test("reconstructTrack drops null-island and invalid coords", () => {
  const pts = northwardTrack();
  pts.push({ ts: "2024-02-01T00:00:00Z", lat: 0, lon: 0 });        // null island
  pts.push({ ts: "2024-02-02T00:00:00Z", lat: 999, lon: 5 });      // out of range
  pts.push({ ts: "not-a-date", lat: 50, lon: 5 });                  // bad ts
  const t = reconstructTrack(pts);
  assert.ok(t);
  assert.equal(t!.pointCount, 10); // only the valid ones
});

test("reconstructTrack flags a teleport outlier without poisoning the next fix", () => {
  const pts = northwardTrack();
  // Impossible 1-hour jump inserted between day 5 and day 6.
  pts.push({ ts: new Date(Date.UTC(2024, 0, 5, 1)).toISOString(), lat: 80, lon: 120 });
  const t = reconstructTrack(pts);
  assert.ok(t);
  // The outlier is excluded; all 10 real points remain visible.
  assert.equal(t!.pointCount, 10);
  const flagged = t!.points.filter((p) => !p.visible);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].lat, 80);
});
