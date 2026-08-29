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

## Analytics

The site uses **Cloudflare Web Analytics**: aggregate page views, referrers,
countries and devices. No cookies, no localStorage, no cross-site identifiers,
nothing that follows a person between sites, which is why it needs no consent
banner under the EU ePrivacy rules. The footer says so plainly.

The token is committed, so any build of this site carries the beacon, local ones
included. The standalone Claude artifacts are generated from `landing.html` and
carry no analytics at all, which is why the privacy line in their footer is
injected only into the website copy.

### How it is wired

The site token is committed in `app/layout.tsx`. That is deliberate: the token is
public by design and ships in the page source of every site using Cloudflare Web
Analytics, so hiding it in an env var would conceal it from nobody while adding a
step that silently breaks measurement when forgotten. Set
`NEXT_PUBLIC_CF_BEACON_TOKEN` in Netlify to override it if you ever rotate it.

### The setting that matters

In Cloudflare → Analytics & Logs → Web Analytics → Manage site, this site must be
on **"Enable with JS Snippet installation"**.

Do not use the automatic modes. `whereanimalsgo.com` was previously on *"Enable,
excluding visitor data in the EU"*, which injects nothing for European visitors.
The dashboard looked healthy while the beacon was reaching almost nobody, since
most of this site's readers are in Europe. Automatic injection also rewrites HTML
at the edge, so it stops working the moment the domain leaves Cloudflare's proxy,
again with no warning.

If you ever switch back to an automatic mode, remove the beacon from
`app/layout.tsx` first, or every visit will be counted twice.

### Content-Security-Policy

`netlify.toml` allows exactly two extra hosts, named explicitly rather than
wildcarded: `static.cloudflareinsights.com` (serves the beacon) and
`cloudflareinsights.com` (receives the aggregate counts). These are the only
third parties the site talks to. Remove both lines if you ever drop analytics.
