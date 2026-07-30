// PHASE 4 — Movebank direct-read (CC0 repository studies, mostly no auth).
// The gotcha: the first read of a study often returns LICENSE TERMS instead of
// data; you must md5-hash the returned terms and re-request with that hash,
// carrying the session cookie. Respect the one-concurrent-request-per-IP limit.

import crypto from "node:crypto";

const BASE = "https://www.movebank.org/movebank/service/direct-read";

function authHeader(): Record<string, string> {
  if (!process.env.MOVEBANK_USER) return {};
  const token = Buffer.from(`${process.env.MOVEBANK_USER}:${process.env.MOVEBANK_PASS}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

/** True if the response body is license terms rather than data. */
export function isLicenseTerms(body: string, headers?: { get(name: string): string | null }): boolean {
  if (headers?.get("accept-license") === "true") return true;
  // Movebank returns a terms blurb; data rows start with an attribute header.
  return /License Terms/i.test(body) || /you must accept the/i.test(body);
}

/**
 * Read from Movebank direct-read, performing the license handshake if needed.
 * Injectable `fetchImpl` so the handshake logic is unit-testable without network.
 */
export async function movebankRead(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const headers = authHeader();
  const url = `${BASE}?${new URLSearchParams(params).toString()}`;
  // Bound each request — Movebank reads can hang on a flaky connection, and a
  // hung fetch (no default timeout) would stall/kill a long sequential harvest.
  const timeout = () => AbortSignal.timeout(90000);

  const res = await fetchImpl(url, { headers, signal: timeout() });
  const cookie = res.headers.get("set-cookie") ?? "";
  const body = await res.text();

  if (isLicenseTerms(body, res.headers)) {
    const md5 = crypto.createHash("md5").update(body).digest("hex");
    const acceptUrl = `${url}&license-md5=${md5}`;
    const res2 = await fetchImpl(acceptUrl, { headers: { ...headers, Cookie: cookie }, signal: timeout() });
    return res2.text();
  }
  return body;
}

/** Build params for an event (location) read of a public study. */
export function eventReadParams(studyId: string | number): Record<string, string> {
  return {
    entity_type: "event",
    study_id: String(studyId),
    attributes: "timestamp,location_long,location_lat,individual_local_identifier,visible",
  };
}

export interface MovebankEvent {
  individual: string;
  ts?: string;
  lon?: number;
  lat?: number;
  visible: boolean;
}

/** Parse Movebank direct-read CSV (comma-separated, header row of attributes). */
export function parseMovebankCsv(text: string): MovebankEvent[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const cTs = col("timestamp");
  const cLon = col("location_long");
  const cLat = col("location_lat");
  const cInd = col("individual_local_identifier");
  const cVis = col("visible");

  const out: MovebankEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",");
    const num = (j: number) => (j >= 0 && f[j] !== "" && f[j] != null ? Number(f[j]) : undefined);
    out.push({
      individual: cInd >= 0 ? (f[cInd] ?? "").trim() : "",
      ts: cTs >= 0 ? f[cTs]?.trim() : undefined,
      lon: num(cLon),
      lat: num(cLat),
      visible: cVis >= 0 ? f[cVis]?.trim().toLowerCase() !== "false" : true,
    });
  }
  return out;
}
