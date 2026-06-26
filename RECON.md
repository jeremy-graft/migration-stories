# Data reconnaissance — what's actually available (empirical)

Run before building anything. Principle from the spec: *never assume a dataset
yields data until a fetch confirms it.* These are real results from the GBIF
public API on 2026-06-26 (no credentials used).

## Headline

Clean, CC0, per-individual migratory GPS tracks exist in abundance — primarily
the **INBO / LifeWatch Belgium** bird-tracking network, published through the
Movebank Data Repository and mirrored on GBIF. Premise confirmed.

## What didn't work (and the fallback that did)

- The spec's Movebank publishingOrg key `143650ce-…-c45572dcc0a8` returns **0**
  datasets via `/dataset/search?publishingOrg=…` (with or without `type=OCCURRENCE`).
- `q=stork tracking&license=CC0_1_0` also returned 0.
- **Working enumeration:** `/dataset/search?q=Movebank&type=OCCURRENCE` → 20 hits,
  nearly all CC0 GPS tracking datasets.

## Candidate datasets (all CC0)

| Dataset | Species | Occurrences | datasetKey |
| --- | --- | ---: | --- |
| SPOONBILL_VLAANDEREN | Eurasian spoonbill *Platalea leucorodia* | 94,975 | `6850e626-46fd-4843-a391-2c06b069a940` |
| LBBG_ADULT | Lesser black-backed gull *Larus fuscus* | 313,658 | `df50c722-070a-4c6a-a260-3a186ce72fe1` |
| CURLEW_VLAANDEREN | Eurasian curlew *Numenius arquata* | 62,960 | `88216808-1942-44ed-b059-b576bf79a28e` |
| H_GRONINGEN | Western marsh harrier *Circus aeruginosus* | 65,022 | `5124534e-2d9c-46b7-a857-e0012821526b` |

Every sampled record carries `decimalLatitude/Longitude`, `eventDate`,
`organismID`, and a CC0 `license`. Several carry an `organismName` — real names:
spoonbill **Wout**, curlew **Marc**, harrier **Roelof** — a gift for storytelling.

## Two API levers that shaped the pipeline

1. **`organismID` is a filterable search param.** `…/occurrence/search?datasetKey=…&organismID=B6918`
   returns just that animal's fixes (Wout = 19,783). So we can pull one
   individual's *complete* track instead of sampling blind.
2. **`organismID` faceting works.** `…&facet=organismID&facetLimit=N` ranks
   individuals by record count, so we pick the richest tracks deterministically.

Top spoonbill individuals by fix count: b6918 (19,783), y0089 (14,045),
b6926 (11,590), b6927 (11,445), b8470 (10,578), b8454 (10,176)…

## Seed choice

Default seed dataset = **SPOONBILL_VLAANDEREN**. Spoonbills make a textbook
long-distance migration (NW-Europe ↔ West Africa, crossing Iberia/Sahara),
the individuals are named, and the tracks are multi-year and dense. The seed
script ranks individuals by a migratory-amplitude score (bbox latitude span,
tie-broken by point count) and picks the best complete track.

Override with `pnpm seed-from-gbif <datasetKey>` to feature a different animal.
