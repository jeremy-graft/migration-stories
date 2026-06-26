import { test } from "node:test";
import assert from "node:assert/strict";
import { movebankRead, eventReadParams, parseMovebankCsv, isLicenseTerms } from "../lib/sources/movebank";

// Minimal Response-like stub for the injected fetch.
function stubRes(body: string, cookie = ""): Response {
  return {
    headers: { get: (n: string) => (n.toLowerCase() === "set-cookie" ? (cookie || null) : null) },
    text: async () => body,
  } as unknown as Response;
}

test("isLicenseTerms detects a terms response", () => {
  assert.equal(isLicenseTerms("These are the License Terms you must accept"), true);
  assert.equal(isLicenseTerms("timestamp,location_long,location_lat\n2024,5,52"), false);
});

test("movebankRead performs the md5+cookie handshake then returns data", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return stubRes("These are the License Terms — you must accept the terms.", "JSESSIONID=abc");
    }
    return stubRes("timestamp,location_long,location_lat,individual_local_identifier,visible\n2024-01-01 00:00,5,52,W1,true");
  }) as unknown as typeof fetch;

  const out = await movebankRead(eventReadParams(123), fakeFetch);
  assert.match(out, /location_long/);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /license-md5=[a-f0-9]{32}/);
  assert.equal(calls[1].init.headers.Cookie, "JSESSIONID=abc");
});

test("movebankRead returns data directly when no terms are shown", async () => {
  const fakeFetch = (async () =>
    stubRes("timestamp,location_long,location_lat,individual_local_identifier,visible\n2024-01-01 00:00,5,52,W1,true")
  ) as unknown as typeof fetch;
  const out = await movebankRead(eventReadParams(1), fakeFetch);
  const rows = parseMovebankCsv(out);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].individual, "W1");
  assert.equal(rows[0].lon, 5);
  assert.equal(rows[0].lat, 52);
  assert.equal(rows[0].visible, true);
});
