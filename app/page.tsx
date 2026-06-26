// Landing: index of available stories.
// Phase 0 placeholder — wired to the DB in Phase 6 (lists only published, commercial-safe stories).
// NOTE: visual design is deliberately plain for now; aesthetic decisions live in DESIGN_NOTES.md.

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <p style={{ letterSpacing: "0.2em", fontSize: 12, opacity: 0.6, textTransform: "uppercase" }}>
        Migration Stories
      </p>
      <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: "0.5rem 0 1rem" }}>
        Following one real animal across its migration.
      </h1>
      <p style={{ fontSize: 18, opacity: 0.8, maxWidth: 560 }}>
        Built from open, openly-licensed animal-tracking data. The data layer is live —
        stories appear here once seeded.
      </p>
      <p style={{ marginTop: 24, fontSize: 14, opacity: 0.55 }}>
        Scaffold ready. Run <code>pnpm seed-from-gbif</code> to land the first animal.
      </p>
    </main>
  );
}
