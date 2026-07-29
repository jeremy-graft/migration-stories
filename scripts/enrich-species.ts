// Enrich our eligible species with an English common name + a taxonomic group,
// from GBIF (the corpus itself has neither). Cached + resumable to rescue/
// species-meta.json — safe to re-run, survives a flaky connection. The catalog
// falls back to the scientific name for anything not (yet) resolved.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { o.push(f); f = ""; } else f += c; }
  o.push(f); return o;
}
const groupOf = (cls: string): string =>
  ({ Aves: "Birds", Mammalia: "Mammals", Reptilia: "Reptiles", Amphibia: "Amphibians",
     Actinopterygii: "Fish", Elasmobranchii: "Fish", Chondrichthyes: "Fish", Testudines: "Reptiles",
     Insecta: "Insects" } as Record<string, string>)[cls] || (cls ? "Other" : "");

// Guaranteed-correct names for the flagships (+ a few GBIF gets wrong), so the
// front page never shows a code or a nickname.
const CURATED: Record<string, string> = {
  "Diomedea exulans": "wandering albatross", "Pagophila eburnea": "ivory gull",
  "Ciconia ciconia": "white stork", "Mirounga leonina": "southern elephant seal",
  "Anser indicus": "bar-headed goose", "Megaptera novaeangliae": "humpback whale",
  "Aptenodytes patagonicus": "king penguin", "Aquila chrysaetos": "golden eagle",
  "Limosa lapponica": "bar-tailed godwit", "Vulpes lagopus": "arctic fox",
  "Thalassarche melanophris": "black-browed albatross", "Macronectes halli": "northern giant petrel",
  "Thalassarche chrysostoma": "grey-headed albatross", "Phoebetria palpebrata": "light-mantled albatross",
};

// Reject obvious junk (dataset codes, IDs) before trusting a vernacular name.
const junk = (s: string) => !s || /\d/.test(s) || s.length < 4 || !/[aeiou]/i.test(s);

// Pick the CONSENSUS English common name: the most frequent one across GBIF's
// sources (a real name repeats; a leaked code/nickname appears once). Tie-break
// toward multi-word, then longer.
function pickVernacular(results: any[]): string {
  const freq = new Map<string, number>();
  for (const r of results) {
    if (r.language !== "eng" || !r.vernacularName) continue;
    const n = r.vernacularName.trim().toLowerCase();
    if (junk(n)) continue;
    freq.set(n, (freq.get(n) || 0) + 1);
  }
  let best = "", score = [-1, -1, -1];
  for (const [n, f] of freq) {
    const s = [f, n.includes(" ") ? 1 : 0, n.length];
    if (s[0] > score[0] || (s[0] === score[0] && (s[1] > score[1] || (s[1] === score[1] && s[2] > score[2])))) {
      score = s; best = n;
    }
  }
  return best;
}

interface Meta { common: string; group: string }
const CACHE = R("rescue/species-meta.json");
const cache: Record<string, Meta> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

const cl = readFileSync(R("rescue/individuals_clean.csv"), "utf8").split("\n").filter(Boolean);
const H = splitCsv(cl[0]); const iSci = H.indexOf("scientific_name"), iElig = H.indexOf("eligible");
const species = [...new Set(cl.slice(1).map(splitCsv).filter((c) => c[iElig] === "t").map((c) => c[iSci]))].sort();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function j(url: string): Promise<any | null> {
  try {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 9000);
    const res = await fetch(url, { signal: ac.signal }); clearTimeout(to);
    if (!res.ok) return null; return await res.json();
  } catch { return null; }
}

async function main() {
  let done = 0, hit = 0;
  for (const sci of species) {
    if (cache[sci]) { done++; continue; }
    const m = await j(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(sci)}`);
    const group = groupOf(m?.class || "");
    let common = CURATED[sci] || "";
    if (!common && m?.usageKey) {
      const v = await j(`https://api.gbif.org/v1/species/${m.usageKey}/vernacularNames?limit=200`);
      common = pickVernacular(v?.results || []);
      await sleep(120);
    }
    cache[sci] = { common: common.toLowerCase(), group };
    if (common) hit++;
    done++;
    if (done % 15 === 0) { writeFileSync(CACHE, JSON.stringify(cache)); process.stdout.write(`\r  ${done}/${species.length} resolved (${hit} named)…`); }
    await sleep(120);
  }
  writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n✓ rescue/species-meta.json — ${done} species, ${Object.values(cache).filter((m) => m.common).length} with a common name`);
}
main().catch((e) => { console.error(e); process.exit(1); });
