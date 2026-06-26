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
  publisherKey?: string;
  raw: unknown;
}

async function fetchJson(url: string, tries = 6): Promise<any> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      // Node fetch has NO default timeout and reuses keep-alive sockets, so a
      // stale socket hangs forever. Bound each request; a timeout aborts and we
      // retry on a fresh connection.
      const res = await fetch(url, {
        headers: { "User-Agent": "migration-stories/0.1 (seed)", Connection: "close" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, Math.min(2000 * (attempt + 1), 8000)));
        continue;
      }
      if (!res.ok) throw new Error(`GBIF ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      // Timeout (AbortError/TimeoutError) or transient network error → backoff + retry
      // on a fresh connection. `Connection: close` above discourages stale-socket reuse.
      if (attempt === tries - 1) throw err;
      process.stderr.write(`r`); // visible retry marker in logs
      await new Promise((r) => setTimeout(r, Math.min(1000 * (attempt + 1), 4000)));
    }
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
    publisherKey: d.publishingOrganizationKey ?? undefined,
    raw: d,
  };
}

// Publisher titles aren't on the dataset endpoint — only the org key. Resolve
// (and cache) via the organization endpoint.
const orgTitleCache = new Map<string, string | undefined>();
export async function gbifOrganizationTitle(key?: string): Promise<string | undefined> {
  if (!key) return undefined;
  if (orgTitleCache.has(key)) return orgTitleCache.get(key);
  try {
    const o = await fetchJson(`${GBIF}/organization/${key}`);
    const t = (o.title as string | undefined) ?? undefined;
    orgTitleCache.set(key, t);
    return t;
  } catch {
    orgTitleCache.set(key, undefined);
    return undefined;
  }
}

/**
 * Generic occurrence-search facet. Returns `{name, count}` for the top
 * `facetLimit` values of `field` under the given query filters. Used by the
 * catalog to enumerate datasets (DATASET_KEY) and species (SPECIES_KEY).
 */
export async function gbifFacet(
  query: Record<string, string>,
  field: string,
  facetLimit = 1500,
): Promise<Array<{ name: string; count: number }>> {
  const params = new URLSearchParams({ ...query, limit: "0", facet: field, facetLimit: String(facetLimit) });
  const j = await fetchJson(`${GBIF}/occurrence/search?${params.toString()}`);
  const f = (j.facets ?? [])[0];
  return (f?.counts ?? []) as Array<{ name: string; count: number }>;
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
