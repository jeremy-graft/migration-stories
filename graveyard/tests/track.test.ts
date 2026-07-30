import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructTrack, thinByInterval, type RawPoint } from "../lib/track";

test("thinByInterval keeps ~1 fix per window (48 hourly fixes → 4 at 12h)", () => {
  const pts = Array.from({ length: 48 }, (_, i) => ({ ts: new Date(Date.UTC(2024, 0, 1, i)), lon: 0, lat: 0 }));
  const thinned = thinByInterval(pts, 12);
  assert.deepEqual(thinned.map((p) => p.ts.getUTCHours()), [0, 12, 0, 12]); // 0h,12h,24h,36h
  assert.equal(thinByInterval(pts, 0).length, 48); // no-op
});

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

test("reconstructTrack accepts ISO-interval eventDate (keys on the start)", () => {
  const pts: RawPoint[] = [];
  for (let i = 0; i < 5; i++) {
    pts.push({ ts: `2024-03-0${i + 1}T00:00:00Z/2024-03-0${i + 2}T12:00:00Z`, lat: 40 + i, lon: 5 });
  }
  const t = reconstructTrack(pts);
  assert.ok(t);
  assert.equal(t!.pointCount, 5);
  assert.equal(t!.trackStart.toISOString().slice(0, 10), "2024-03-01");
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
