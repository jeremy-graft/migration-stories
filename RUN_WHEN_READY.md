# Run when ready — credential-gated steps

Everything here is **deferred** because it needs an account this session didn't
have. The no-auth path (scaffold → schema → GBIF seed → one rendered animal) is
already done and needs none of this.

## 0. Rotate the Neon password (do this first)

The `DATABASE_URL` password was pasted into a chat to bootstrap the project.
It's only in the gitignored `.env` (never committed), but rotate it to be safe:
Neon dashboard → project **Dieren** → Roles → reset `neondb_owner` password →
update `DATABASE_URL` in `.env`.

## 1. GBIF batch download — Phase 3 (scale)

The predicate builder and CSV parser are implemented and unit-tested
(`tests/gbif-predicate.test.ts`). Only the live HTTP needs an account.

1. Register at https://www.gbif.org → set in `.env`:
   ```
   GBIF_USER=...
   GBIF_PASS=...
   GBIF_EMAIL=...
   ```
2. Run: `pnpm ingest-gbif-batch 212 NL` (taxonKey 212 = Aves; optional country).
3. **Record the download DOI** the script prints — it's the required citation.
4. **One piece of wiring left:** the script requests `DWCA` (Darwin Core Archive,
   a zip) because GBIF's `SIMPLE_CSV` does **not** include `organismID`, which we
   need for per-individual tracks. After the zip downloads, extract
   `occurrence.txt` and feed it through the already-written pipeline:
   ```ts
   const rows = parseOccurrenceCsv(fs.readFileSync("occurrence.txt", "utf8")); // tab-separated
   const byInd = groupByIndividual(rows);
   await ingestTracks(datasetMeta, [...byInd].map(([id, pts]) => ({ sourceIndividualId: id, points: pts.map(r => ({ ts: r.eventDate, lon: r.lon, lat: r.lat })) })));
   ```
   (Pick an unzip approach — Node has no built-in zip reader; `unzipper` or
   `yauzl` work. Left out to avoid adding a dep before it's needed.)

## 2. Movebank direct studies — Phase 4

The license-acceptance handshake and CSV parser are implemented and unit-tested
(`tests/movebank.test.ts`). Many repository studies read with **no** auth:

- Try a public study now (no creds): `pnpm ingest-movebank-repo <studyId> "Genus species" "Common name"`.
- For studies that require it, set `MOVEBANK_USER` / `MOVEBANK_PASS` in `.env`.
- ⚠️ Movebank direct-read doesn't reliably expose a machine-readable license.
  The script asserts CC0 for repository studies — **verify each study's license**
  before trusting it for commercial use.
- **Pending list:** `pnpm catalog-movebank` already enumerated the 164 public
  studies (109 GPS) into `MOVEBANK_PENDING.md`, but their `license_type` returns
  HTTP 401 anonymously — so they are **NOT** in the commercial-safe `datasets`
  index. With an account, read each study's `license_type` + taxa, gate to
  CC0/CC-BY, then ingest. That's the only piece that needs Movebank creds.

## 3. MapTiler basemap — optional

Without `MAPTILER_KEY` the map falls back to a free demo style. For production
tiles, get a key at https://www.maptiler.com and set `MAPTILER_KEY` in `.env`.

## Already done (no action needed)

- `pnpm db:migrate` has been run; the 4 tables exist in Neon.
- One real CC0 animal is seeded and rendered.
