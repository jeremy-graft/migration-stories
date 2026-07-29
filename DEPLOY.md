# Deploying "Where Animals Go"

The site is a **fully static export**. `npm run build` writes a plain `out/` folder
(HTML + JS + the `/data` JSON files) — no server, no database, hosts anywhere free.

## What's in a build

- `out/index.html` — the landing (dot-matrix Earth + flying camera + 10 featured animals)
- `out/explore/` — the searchable catalog of all 338 species
- `out/journey/<species>/` — one page per species (338 of them)
- `out/data/*.json` — the payloads the pages fetch (Earth grids + per-animal tracks)

The `/data` files are generated offline from the corpus and are **committed to the repo**
(the source CSVs in `rescue/` are gitignored and not needed to build). Regenerate them
only when the data changes:

```bash
npm run build-hero        # landing payload + hero component
npm run tsx scripts/export-journeys.ts   # per-animal catalog files
```

## Option A — drag-and-drop (fastest, no account wiring)

```bash
npm run build
```

Then drag the **`out/`** folder onto Netlify:
- New site: https://app.netlify.com/drop
- Existing site (replaces the current landing-only drop): its **Deploys** tab → drag `out/` onto the drop zone.

Live in ~30 seconds at the same URL.

## Option B — Git-connected (auto-deploys on every push)

1. Create a GitHub repo and push this project (the `main` branch).
2. Netlify → **Add new site → Import from Git** → pick the repo.
3. Netlify reads `netlify.toml` automatically:
   - build command `npm run build`
   - publish directory `out`
4. Deploy. Every `git push` now rebuilds and republishes.

Vercel works the same way (it auto-detects Next.js static export; no config needed).

## Notes

- Commit `public/data/**` — it's the built data the pages fetch. Without it, journey
  pages have nothing to render.
- `out/` is gitignored (it's a build artifact); the host regenerates it.
- Node 20 is pinned in `netlify.toml`.
