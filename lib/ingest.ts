// Shared ingest writer used by the scale pipelines (GBIF batch, Movebank).
// License-gated, idempotent per dataset. Reconstructs each individual's track
// and writes datasets / individuals / track_points. Stories are curated
// separately (the foundation is data; stories are an editorial layer).

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { datasets, individuals, trackPoints, stories } from "../db/schema";
import { isCommercialSafe, type License } from "./licenses";
import { reconstructTrack, type RawPoint } from "./track";

export interface DatasetInput {
  id: string; // e.g. "gbif:<key>" or "movebank_repo:<studyId>"
  source: "gbif" | "movebank_repo" | "movebank_direct";
  title: string;
  doi?: string;
  license: License;
  citation?: string;
  publisher?: string;
  raw?: object;
}

export interface IndividualInput {
  sourceIndividualId: string;
  name?: string;
  scientificName?: string;
  commonName?: string;
  sex?: string;
  lifeStage?: string;
  points: RawPoint[];
  raw?: object;
}

export interface IngestSummary {
  datasetId: string;
  individualsWritten: number;
  pointsWritten: number;
  skipped: number;
}

export async function ingestTracks(
  ds: DatasetInput,
  inds: IndividualInput[],
  opts: { minPoints?: number } = {},
): Promise<IngestSummary> {
  const minPoints = opts.minPoints ?? 50;

  // License gate — the single mandatory check before any write.
  if (!isCommercialSafe(ds.license)) {
    throw new Error(`Refusing to ingest ${ds.id}: license ${ds.license} is not commercial-safe.`);
  }

  // Idempotent re-ingest (FK-safe order).
  const existing = await db.select({ id: individuals.id }).from(individuals).where(eq(individuals.datasetId, ds.id));
  if (existing.length) {
    const ids = existing.map((r) => r.id);
    await db.delete(stories).where(inArray(stories.individualId, ids));
    await db.delete(trackPoints).where(inArray(trackPoints.individualId, ids));
    await db.delete(individuals).where(eq(individuals.datasetId, ds.id));
  }
  await db.delete(datasets).where(eq(datasets.id, ds.id));

  const taxa = new Set<string>();
  let individualsWritten = 0, pointsWritten = 0, skipped = 0;

  // Insert dataset first (bbox/recordCount backfilled implicitly via individuals).
  await db.insert(datasets).values({
    id: ds.id, source: ds.source, title: ds.title, doi: ds.doi, license: ds.license,
    citation: ds.citation, publisher: ds.publisher, taxa: [], raw: ds.raw,
  });

  for (const ind of inds) {
    const track = reconstructTrack(ind.points);
    if (!track || track.pointCount < minPoints) { skipped++; continue; }
    if (ind.scientificName) taxa.add(ind.scientificName);

    const [row] = await db.insert(individuals).values({
      datasetId: ds.id,
      sourceIndividualId: ind.sourceIndividualId,
      name: ind.name,
      scientificName: ind.scientificName,
      commonName: ind.commonName,
      sex: ind.sex,
      lifeStage: ind.lifeStage,
      trackStart: track.trackStart,
      trackEnd: track.trackEnd,
      pointCount: track.pointCount,
      distanceKm: track.distanceKm,
      bbox: track.bbox,
      raw: ind.raw,
    }).returning({ id: individuals.id });

    const rows = track.points.map((p) => ({
      individualId: row.id, ts: p.ts, lon: p.lon, lat: p.lat, visible: p.visible,
    }));
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(trackPoints).values(rows.slice(i, i + CHUNK));
    }
    individualsWritten++;
    pointsWritten += rows.length;
  }

  if (taxa.size) {
    await db.update(datasets).set({ taxa: [...taxa] }).where(eq(datasets.id, ds.id));
  }
  return { datasetId: ds.id, individualsWritten, pointsWritten, skipped };
}
