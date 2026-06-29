import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

// Local embedded Postgres (PGlite). Robust to network drops and fast for bulk
// ingestion. Data lives on disk at <project>/.pgdata (override with PGLITE_DIR).
// Production (Vercel) would point at Neon instead; this is the build-time store.
// NOTE: PGlite is single-process — don't run the dev server and an ingest script
// against the same data dir at once.
const dir = process.env.PGLITE_DIR || fileURLToPath(new URL("../.pgdata", import.meta.url));

export const client = new PGlite(dir);
export const db = drizzle(client, { schema });

/**
 * Raw tagged-template query returning a rows array — Neon-compatible, so ETL
 * scripts that did `const sql = neon(url)` can just `import { sql }` instead.
 *   await sql`select count(*)::int n from datasets`  ->  [{ n: 281 }]
 */
export async function sql(strings: TemplateStringsArray, ...vals: unknown[]): Promise<any[]> {
  let q = strings[0];
  for (let i = 0; i < vals.length; i++) q += `$${i + 1}${strings[i + 1]}`;
  const res = await client.query(q, vals as any[]);
  return res.rows as any[];
}

export { schema };
