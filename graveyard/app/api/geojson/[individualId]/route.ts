// Serves the cached GeoJSON render artifact for an individual, from our DB.
// The front end reads ONLY this — never a source API.
import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { stories } from "@/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ individualId: string }> },
) {
  const { individualId } = await params;
  const [s] = await db
    .select({ geojson: stories.geojson })
    .from(stories)
    .where(eq(stories.individualId, individualId))
    .limit(1);
  if (!s?.geojson) return new Response("Not found", { status: 404 });
  return Response.json(s.geojson, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
