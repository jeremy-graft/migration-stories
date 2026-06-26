# Design notes — your eye gets the last word

You asked to focus on **data, not the look**, this session — so this is
deliberately *options to react to*, not decisions made. The story page is
currently plain and functional. When you want to spend craft on Phase 5, here's
a starting point grounded in the subject (migration, telemetry, cartography),
explicitly avoiding the AI-default looks the spec calls out.

## The one signature moment

Everything bends to this: **the track drawing itself across the map in time**,
with narrative beats revealed as the line advances. That's where boldness goes.
Everything else stays quiet and lets the journey lead. We already store a
downsampled `[lon, lat, ts]` timeline on each story for exactly this animation,
plus a `prefers-reduced-motion` fallback (full route drawn, beats as a list).

## Three directions (pick one to develop, or mix)

**A — "Ringer's field notebook."** Warm paper-toned UI chrome around a cool,
desaturated terrain map. Type: a characterful humanist serif for headers, a calm
grotesk for body, a mono for the data (coords/dates/distances). Feels like a
banding/ringing record. Risk: drifts toward the cream+serif AI-default — keep
the map cold and dominant to avoid it.

**B — "Telemetry console."** Dark, map-forward, the track as a luminous filament
over muted terrain; data rendered like instrument readouts (mono, tabular
figures). Restrained single hue tied to the species/route, not an acid accent.
Risk: near-black+one-accent is an AI-default — earn the palette from the bird
(spoonbill = pale rose/sand; gull = slate/white) rather than picking neon.

**C — "Cartographer's plate."** Light, print-map sensibility: graticule lines,
a hand-set title block, hairline scale bar, the route as a confident ink stroke.
Type: a display face with real character used once, body kept neutral.
Risk: hairline-broadsheet is an AI-default — lean on the *map plate* texture and
the moving line to differentiate.

## Type pairing

Your portfolio hints at Cormorant Garamond / Bebas Neue / DM Mono. Use that as a
read on your taste, not a mandate — let the subject choose. A safe, subject-true
trio: a warm serif or a characterful grotesk for display, a quiet body face, and
**DM Mono (or similar) for all data** — coordinates, timestamps, distances. The
mono-for-data rule is the single most "telemetry" move and worth keeping in any
direction.

## Palette derivation (a rule, not a swatch)

Derive the accent from the **animal/route**, sampled and desaturated, so each
story can carry its own quiet hue while the chrome stays neutral. Spoonbill
"Wout" → pale rose / Sahara sand. This keeps the system from looking templated
across stories.

## Quality floor (non-negotiable regardless of direction)

Responsive to mobile · visible keyboard focus · fast (static GeoJSON, no live
API calls) · reduced-motion fallback that is *still beautiful*.

---

**Decision needed from you:** which direction (A/B/C/other), and a yes/no on the
mono-for-data rule. Once you point, Phase 5 becomes a focused build.
