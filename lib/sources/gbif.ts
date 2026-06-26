// GBIF source adapter — public occurrence search (NO auth) for seeding,
// plus dataset metadata. The async download API (auth) lives in scripts/ingest-gbif-batch.
//
// Politeness: sequential requests, backoff on HTTP 429, small page sizes.
// The front end NEVER calls these — ingestion is offline only.

const GBIF = "https://api.gbif.org/v1";

/** A single GBIF occurrence record, trimmed to the fields we use. */
export interface GbifOccurrence {
  key?: number;
  decimalLatitude?: number;
  decimalLongitude?: number;
  eventDate?: string;
  organismID?: string;
  organismName?: string;
  individualID?: string;
  scientificName?: string;
  vernacularName?: string;
  sex?: string;
  lifeStage?: string;
  license?: string;
}

/** Dataset-level metadata used for attribution. */
export interface GbifDataset {
  key: string;
  title: string;
  doi?: string;
  license?: string;
  citation?: string;
  publisher?: string;
  raw: unknown;
}

async function fetchJson(url: string, tries = 5): Promise<any> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "migration-stories/0.1 (seed)" } });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(2000 * (attempt + 1), 8000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`GBIF ${res.status} for ${url}`);
    return res.json();
  }
  throw new Error(`GBIF: exhausted retries for ${url}`);
}

/** Fetch dataset metadata for attribution. */
export async function gbifDataset(datasetKey: string): Promise<GbifDataset> {
  const d = await fetchJson(`${GBIF}/dataset/${datasetKey}`);
  return {
    key: datasetKey,
    title: d.title ?? datasetKey,
    doi: d.doi ?? undefined,
    license: d.license ?? undefined,
    citation: d.citation?.text ?? undefined,
    publisher: d.publishingOrganizationTitle ?? undefined,
    raw: d,
  };
}

/** Rank individuals in a dataset by record count, via the ORGANISM_ID facet. */
export async function gbifTopOrganisms(
  datasetKey: string,
  limit = 12,
): Promise<Array<{ id: string; count: number }>> {
  const url =
    `${GBIF}/occurrence/search?datasetKey=${datasetKey}` +
    `&limit=0&facet=organismID&facetLimit=${limit}`;
  const j = await fetchJson(url);
  const facet = (j.facets ?? []).find((f: any) => f.field === "ORGANISM_ID") ?? (j.facets ?? [])[0];
  return ((facet?.counts ?? []) as Array<{ name: string; count: number }>).map((c) => ({
    id: c.name,
    count: c.count,
  }));
}

/**
 * Stream occurrences for a dataset (optionally one organism), paginated, no auth.
 * Backs off on 429. Stops at endOfRecords or `cap`.
 */
export async function* gbifOccurrences(
  datasetKey: string,
  opts: { organismID?: string; cap?: number } = {},
): AsyncGenerator<GbifOccurrence> {
  const { organismID, cap = 30000 } = opts;
  const limit = 300;
  let offset = 0;
  let yielded = 0;
  while (yielded < cap) {
    const params = new URLSearchParams({
      datasetKey,
      limit: String(limit),
      offset: String(offset),
    });
    if (organismID) params.set("organismID", organismID);
    const j = await fetchJson(`${GBIF}/occurrence/search?${params.toString()}`);
    const results = j.results ?? [];
    for (const r of results) {
      yield r as GbifOccurrence;
      if (++yielded >= cap) break;
    }
    // Stop on endOfRecords OR an empty page (guards against a pathological loop).
    if (j.endOfRecords || results.length === 0) break;
    offset += limit;
  }
}
