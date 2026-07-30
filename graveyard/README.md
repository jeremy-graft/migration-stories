# graveyard

Archived code, kept for the record rather than for running.

Everything here belonged to the **database era** of this project. The corpus was
originally built in Postgres (Neon, then a local embedded PGlite). That database
died: repeated hard kills corrupted its indexes, it could not rebuild them at 5.7M
rows, and the heap was evacuated to `rescue/*.csv`, which is now the source of
truth. Every analysis, every page and the whole publish pipeline read those files
directly, so nothing in the live site touches a database at all.

## Why it moved here

Keeping it in the live tree meant carrying `drizzle-orm`, `drizzle-kit`,
`@electric-sql/pglite`, `@neondatabase/serverless`, `maplibre-gl`, `@turf/turf`,
`unzipper` and `seek-bzip` as dependencies for code that cannot run. That is
supply-chain surface and audit noise for no benefit: a security review flagged a
SQL-injection advisory against an ORM this site never loads. The site now has
three runtime dependencies: `next`, `react`, `react-dom`.

## What's here

- `db/`, `drizzle.config.ts` — schema and migrations for the dead database
- `scripts/` — every ingester (GBIF, Movebank, Zenodo, Dryad, ATN, USGS ScienceBase,
  PANGAEA) plus the DB-bound analysis and repair tooling
- `lib/` — `ingest.ts` (writes to the DB), `track.ts`/`story.ts` (turf),
  `csv-tracks.ts` (the fuzzy CSV parser the ingesters shared), `sources/`
- `components/` — the original MapLibre story view and its attribution block
- `tests/` — tests for the modules above
- `app/` — the original DB-backed story and geojson routes

## If you ever need this again

These files have **not** been kept runnable. Relative imports across the
live/archive boundary will not resolve, and the packages are uninstalled. To
revive any of it: reinstall the dependencies it needs, fix the import paths, and
point it at a real database. Note that reviving ingestion is not the obvious move
anyway. The better path, if the corpus should grow again, is to teach an ingester
to append to `rescue/*.csv` and skip the database entirely, which is how
everything else already works.

Git history has the full working versions if you need them.
