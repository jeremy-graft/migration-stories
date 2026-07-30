// PHASE 3 — GBIF async download API (AUTH) for license-filtered bulk ingestion.
// Pure, testable building blocks: predicate builder + CSV parser. The live HTTP
// (POST download, poll, fetch zip) lives in scripts/ingest-gbif-batch.ts.
//
// NOTE: GBIF SIMPLE_CSV does NOT carry organismID, so per-individual track
// reconstruction needs the DWCA format (verbatim terms). The parser below is
// column-driven and works with either, keying on organismID when present.

import { normalizeLicense, type License } from "../licenses";

export type GbifLicense = "CC0_1_0" | "CC_BY_4_0" | "CC_BY_NC_4_0";

export interface DownloadPredicateOpts {
  /** Allowed licenses (commercial-safe set by default). */
  licenses?: GbifLicense[];
  /** GBIF taxonKey, e.g. "212" = Aves. */
  taxonKey?: string;
  /** Restrict to specific datasets. */
  datasetKeys?: string[];
  /** Restrict to a publishing organization (e.g. INBO). */
  publishingOrg?: string;
  /** ISO country code, e.g. "NL". */
  country?: string;
  /** WKT polygon for spatial bounds (within predicate). */
  wkt?: string;
  /** Require present (not absent) occurrences and coordinates. */
  withCoordinate?: boolean;
}

/** Build the GBIF download `predicate` object (the hard, error-prone part). */
export function buildDownloadPredicate(opts: DownloadPredicateOpts): object {
  const licenses = opts.licenses ?? ["CC0_1_0", "CC_BY_4_0"];
  const predicates: object[] = [
    { type: "in", key: "LICENSE", values: licenses },
    { type: "equals", key: "OCCURRENCE_STATUS", value: "PRESENT" },
  ];
  if (opts.taxonKey) predicates.push({ type: "equals", key: "TAXON_KEY", value: opts.taxonKey });
  if (opts.datasetKeys?.length) predicates.push({ type: "in", key: "DATASET_KEY", values: opts.datasetKeys });
  if (opts.publishingOrg) predicates.push({ type: "equals", key: "PUBLISHING_ORG", value: opts.publishingOrg });
  if (opts.country) predicates.push({ type: "equals", key: "COUNTRY", value: opts.country });
  if (opts.withCoordinate !== false) predicates.push({ type: "equals", key: "HAS_COORDINATE", value: "true" });
  if (opts.wkt) predicates.push({ type: "within", geometry: opts.wkt });
  return { type: "and", predicates };
}

/** Full request body for POST /occurrence/download. */
export function buildDownloadRequest(params: {
  creator: string;
  email: string;
  predicate: object;
  format?: "SIMPLE_CSV" | "DWCA";
}): object {
  return {
    creator: params.creator,
    notificationAddresses: [params.email],
    sendNotification: false,
    format: params.format ?? "SIMPLE_CSV",
    predicate: params.predicate,
  };
}

export interface ParsedOccurrence {
  organismID?: string;
  scientificName?: string;
  lat?: number;
  lon?: number;
  eventDate?: string;
  license: License;
}

/**
 * Parse a GBIF occurrence export (tab-separated by default for SIMPLE_CSV).
 * Column-driven: reads by header name, tolerant of column order/extra columns.
 */
export function parseOccurrenceCsv(text: string, delimiter = "\t"): ParsedOccurrence[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(delimiter);
  const idx = (name: string) => header.indexOf(name);
  const cLat = idx("decimalLatitude");
  const cLon = idx("decimalLongitude");
  const cDate = idx("eventDate");
  const cLic = idx("license");
  const cOrg = idx("organismID");
  const cSci = idx("species") >= 0 ? idx("species") : idx("scientificName");

  const out: ParsedOccurrence[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(delimiter);
    const num = (j: number) => (j >= 0 && f[j] !== "" && f[j] != null ? Number(f[j]) : undefined);
    out.push({
      organismID: cOrg >= 0 ? f[cOrg] || undefined : undefined,
      scientificName: cSci >= 0 ? f[cSci] || undefined : undefined,
      lat: num(cLat),
      lon: num(cLon),
      eventDate: cDate >= 0 ? f[cDate] || undefined : undefined,
      license: normalizeLicense(cLic >= 0 ? f[cLic] : undefined),
    });
  }
  return out;
}

/** Group parsed rows by individual (organismID), dropping rows without one. */
export function groupByIndividual(rows: ParsedOccurrence[]): Map<string, ParsedOccurrence[]> {
  const m = new Map<string, ParsedOccurrence[]>();
  for (const r of rows) {
    if (!r.organismID) continue;
    const arr = m.get(r.organismID) ?? [];
    arr.push(r);
    m.set(r.organismID, arr);
  }
  return m;
}
