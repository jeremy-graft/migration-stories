import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Server-only DB client. The front end reads only from here (and cached GeoJSON);
// it never calls source APIs live.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

const sql = neon(url);
export const db = drizzle(sql, { schema });
export { schema };
