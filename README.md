# Migration Stories

A web app where each "story" follows one real tracked animal across its migration — the
track draws itself across a map as the animal travels, with narrative beats keyed to moments
in the journey. Underneath sits an aggregated, normalized database of open migration data.

**Honest framing:** the data is openly licensed (anyone can pull it); the value is the
aggregation + normalization + editorial storytelling. Only CC0 / CC BY records are ingested
and surfaced (commercial-safe by default). Attribution — species, source, DOI, license,
citation — is shown on every story, not just stored.

## Stack

- Next.js (App Router) + TypeScript on Vercel
- Neon (Postgres) via `@neondatabase/serverless` + Drizzle ORM
- MapLibre GL JS, MapTiler basemap (optional key; demo-style fallback)
- Turf.js for geo; `tsx` ETL scripts in `/scripts`
- pnpm

## Setup

```bash
pnpm install
cp .env.example .env      # fill in DATABASE_URL (Neon). Others optional.
pnpm db:generate          # generate SQL migration from db/schema.ts
pnpm db:migrate           # apply to Neon
```

## Run

```bash
pnpm dev                  # http://localhost:3000
pnpm typecheck            # tsc --noEmit
pnpm test                 # unit tests (licenses, track recon, predicate, movebank)
```

## Data pipelines

| Script | Phase | Auth | What it does |
| --- | --- | --- | --- |
| `pnpm seed-from-gbif` | 2 | none | Pulls one CC0 migratory animal from GBIF's public search, reconstructs its track, writes a draft story. **The key no-auth path.** |
| `pnpm ingest-gbif-batch` | 3 | GBIF account | License-filtered bulk download via GBIF async download API. |
| `pnpm ingest-movebank-repo` | 4 | mostly none | Movebank direct-read with license-acceptance handshake. |
| `pnpm build-geojson` | — | none | Regenerate cached GeoJSON render artifacts. |

Credential-gated steps are listed in [RUN_WHEN_READY.md](RUN_WHEN_READY.md).
Data reconnaissance findings are in [RECON.md](RECON.md).
Aesthetic decisions deferred to Jeremy are in [DESIGN_NOTES.md](DESIGN_NOTES.md).

## Non-negotiables

1. The front end never calls source APIs live — it reads only our DB + cached GeoJSON.
2. Only CC0 / CC BY ingested (CC BY-NC excluded unless `ALLOW_NC=true`).
3. Every story shows full attribution.
4. Secrets via `.env` (gitignored); never committed.
