// The mammal roster — classify our species via GBIF and list the Mammalia,
// grouped by order, so we can see the storytelling material we actually hold.
import "dotenv/config";
import { sql, client } from "../db/index";

async function gbif(name: string): Promise<{ class?: string; order?: string }> {
  try {
    const m = await (await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15000) })).json();
    return { class: m.class, order: m.order };
  } catch { return {}; }
}

async function main() {
  const rows = (await sql`
    select scientific_name sp, count(*)::int animals, sum(coalesce(point_count,0))::int pts,
           max(common_name) common
    from individuals where scientific_name is not null
    group by scientific_name`) as any[];

  const byOrder = new Map<string, { sp: string; animals: number; pts: number }[]>();
  let totSp = 0, totAn = 0;
  for (const r of rows) {
    const g = await gbif(r.sp);
    if (g.class !== "Mammalia") continue;
    totSp++; totAn += r.animals;
    const ord = g.order || "Other";
    (byOrder.get(ord) ?? byOrder.set(ord, []).get(ord)!).push({ sp: r.sp, animals: r.animals, pts: r.pts });
  }

  console.log(`\nMAMMALS: ${totSp} species · ${totAn.toLocaleString()} animals\n`);
  const orders = [...byOrder.entries()].sort((a, b) => b[1].reduce((s, x) => s + x.animals, 0) - a[1].reduce((s, x) => s + x.animals, 0));
  for (const [ord, list] of orders) {
    const an = list.reduce((s, x) => s + x.animals, 0);
    console.log(`── ${ord}  (${list.length} sp · ${an.toLocaleString()} animals)`);
    for (const x of list.sort((a, b) => b.animals - a.animals).slice(0, 8))
      console.log(`     ${x.sp.padEnd(30)} ${String(x.animals).padStart(5)} animals  ${(x.pts / 1000).toFixed(0)}k pts`);
    if (list.length > 8) console.log(`     …and ${list.length - 8} more`);
  }
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
