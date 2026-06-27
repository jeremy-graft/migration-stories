// db/schema.ts
import {
  pgTable, uuid, text, timestamp, doublePrecision,
  boolean, integer, bigserial, jsonb, pgEnum, index,
} from "drizzle-orm/pg-core";

export const licenseEnum = pgEnum("license", [
  "CC0_1_0", "CC_BY_4_0", "CC_BY_NC_4_0", "OTHER",
]);

export const sourceEnum = pgEnum("source", ["gbif", "movebank_repo", "movebank_direct"]);

export const datasets = pgTable("datasets", {
  id: text("id").primaryKey(),              // gbif datasetKey or movebank study id, prefixed by source
  source: sourceEnum("source").notNull(),
  title: text("title").notNull(),
  doi: text("doi"),
  license: licenseEnum("license").notNull(),
  citation: text("citation"),
  publisher: text("publisher"),
  taxa: text("taxa").array(),               // scientific names present
  telemetryType: text("telemetry_type"),    // gps/argos | acoustic | imaging/camera | gps/other
  taxonGroup: text("taxon_group"),          // bird | mammal | fish/inverts | reptile | …
  bbox: doublePrecision("bbox").array(),    // [minLon,minLat,maxLon,maxLat]
  recordCount: integer("record_count"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow(),
  raw: jsonb("raw"),                        // source metadata as-is
});

export const individuals = pgTable("individuals", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetId: text("dataset_id").notNull().references(() => datasets.id),
  sourceIndividualId: text("source_individual_id").notNull(), // organismID / individual_local_identifier
  name: text("name"),                       // display name if any
  scientificName: text("scientific_name"),
  commonName: text("common_name"),
  sex: text("sex"),
  lifeStage: text("life_stage"),
  trackStart: timestamp("track_start", { withTimezone: true }),
  trackEnd: timestamp("track_end", { withTimezone: true }),
  pointCount: integer("point_count"),
  distanceKm: doublePrecision("distance_km"),
  bbox: doublePrecision("bbox").array(),
  raw: jsonb("raw"),
});

export const trackPoints = pgTable("track_points", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  individualId: uuid("individual_id").notNull().references(() => individuals.id),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  lon: doublePrecision("lon").notNull(),
  lat: doublePrecision("lat").notNull(),
  visible: boolean("visible").default(true), // false = flagged outlier
}, (t) => ({
  byIndividualTs: index("track_points_individual_ts_idx").on(t.individualId, t.ts),
}));

export const stories = pgTable("stories", {
  id: uuid("id").primaryKey().defaultRandom(),
  individualId: uuid("individual_id").notNull().references(() => individuals.id),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  dek: text("dek"),                         // one-line subtitle
  beats: jsonb("beats"),                    // [{atTs, lon?, lat?, heading, body}]
  geojson: jsonb("geojson"),                // cached render artifact (or store in blob + url)
  status: text("status").default("draft"), // draft | published
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
