CREATE TYPE "public"."license" AS ENUM('CC0_1_0', 'CC_BY_4_0', 'CC_BY_NC_4_0', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('gbif', 'movebank_repo', 'movebank_direct');--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "source" NOT NULL,
	"title" text NOT NULL,
	"doi" text,
	"license" "license" NOT NULL,
	"citation" text,
	"publisher" text,
	"taxa" text[],
	"bbox" double precision[],
	"record_count" integer,
	"ingested_at" timestamp with time zone DEFAULT now(),
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "individuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" text NOT NULL,
	"source_individual_id" text NOT NULL,
	"name" text,
	"scientific_name" text,
	"common_name" text,
	"sex" text,
	"life_stage" text,
	"track_start" timestamp with time zone,
	"track_end" timestamp with time zone,
	"point_count" integer,
	"distance_km" double precision,
	"bbox" double precision[],
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"individual_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"dek" text,
	"beats" jsonb,
	"geojson" jsonb,
	"status" text DEFAULT 'draft',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "stories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "track_points" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"individual_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lon" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"visible" boolean DEFAULT true
);
--> statement-breakpoint
ALTER TABLE "individuals" ADD CONSTRAINT "individuals_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_individual_id_individuals_id_fk" FOREIGN KEY ("individual_id") REFERENCES "public"."individuals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_points" ADD CONSTRAINT "track_points_individual_id_individuals_id_fk" FOREIGN KEY ("individual_id") REFERENCES "public"."individuals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_points_individual_ts_idx" ON "track_points" USING btree ("individual_id","ts");