import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/index";
import { stories, individuals, datasets } from "@/db/schema";
import { StoryView, type Beat } from "@/components/StoryView";
import type { License } from "@/lib/licenses";

interface StoryGeo {
  bbox: [number, number, number, number];
  properties: { timeline: [number, number, string][] };
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [story] = await db.select().from(stories).where(eq(stories.slug, slug)).limit(1);
  if (!story) notFound();

  const [ind] = await db.select().from(individuals).where(eq(individuals.id, story.individualId)).limit(1);
  const [ds] = ind ? await db.select().from(datasets).where(eq(datasets.id, ind.datasetId)).limit(1) : [undefined];

  const geo = story.geojson as unknown as StoryGeo;
  const timeline = geo?.properties?.timeline ?? [];
  const bbox = geo?.bbox ?? (ind?.bbox as [number, number, number, number]) ?? [-10, 35, 10, 55];
  const beats = (story.beats as unknown as Beat[]) ?? [];

  return (
    <StoryView
      title={story.title}
      dek={story.dek}
      timeline={timeline}
      bbox={bbox}
      beats={beats}
      attribution={{
        scientificName: ind?.scientificName,
        commonName: ind?.commonName,
        source: ds?.source ?? "gbif",
        datasetTitle: ds?.title ?? "—",
        doi: ds?.doi,
        license: (ds?.license as License) ?? "OTHER",
        citation: ds?.citation,
        publisher: ds?.publisher,
      }}
    />
  );
}
