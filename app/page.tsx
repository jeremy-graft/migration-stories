// Landing: index of PUBLISHED, commercial-safe stories.
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/index";
import { stories, individuals } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const rows = await db
    .select({
      slug: stories.slug, title: stories.title, dek: stories.dek,
      commonName: individuals.commonName, scientificName: individuals.scientificName,
      distanceKm: individuals.distanceKm,
    })
    .from(stories)
    .innerJoin(individuals, eq(individuals.id, stories.individualId))
    .where(eq(stories.status, "published"));

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <p style={{ letterSpacing: "0.2em", fontSize: 12, opacity: 0.6, textTransform: "uppercase" }}>
        Migration Stories
      </p>
      <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: "0.5rem 0 1rem" }}>
        Following one real animal across its migration.
      </h1>
      <p style={{ fontSize: 17, opacity: 0.8, maxWidth: 560 }}>
        Built from open, openly-licensed animal-tracking data (CC0 / CC BY only).
      </p>

      {rows.length === 0 ? (
        <p style={{ marginTop: 32, opacity: 0.6 }}>
          No published stories yet. Seed one with <code>pnpm seed-from-gbif</code>, then publish it.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 32, display: "grid", gap: 12 }}>
          {rows.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/stories/${s.slug}`}
                style={{
                  display: "block", textDecoration: "none", color: "#e6e8eb",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "16px 18px",
                }}
              >
                <div style={{ fontSize: 20 }}>{s.title}</div>
                <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>
                  {s.commonName ? `${s.commonName} · ` : ""}<em>{s.scientificName}</em>
                  {s.distanceKm ? ` · ${Math.round(s.distanceKm).toLocaleString()} km` : ""}
                </div>
                {s.dek ? <div style={{ fontSize: 14, opacity: 0.6, marginTop: 6 }}>{s.dek}</div> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
