// Honest inventory of the corpus as it actually stands, applying the same
// quarantine every analysis uses. Uses the quote-aware CSV splitter — a naive
// split(",") misaligns rows whose name field contains a comma and invents
// phantom species (it reported 380 instead of the true count).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BAD_SPECIES, BAD_INDIVIDUALS } from "../lib/bad-species";

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
function splitCsv(l: string): string[] {
  const o: string[] = []; let f = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { o.push(f); f = ""; }
    else f += c;
  }
  o.push(f); return o;
}

const inds = readFileSync(R("rescue/individuals.csv"), "utf8").split("\n").filter(Boolean);
const species = new Set<string>(), datasets = new Set<string>();
const perSpecies = new Map<string, number>();
let named = 0, unnamed = 0, analysisGrade = 0, quarantined = 0;

for (let i = 1; i < inds.length; i++) {
  const c = splitCsv(inds[i]);
  if (BAD_INDIVIDUALS.has(c[0])) { quarantined++; continue; }
  const sci = c[4];
  if (!sci) { unnamed++; continue; }
  if (BAD_SPECIES.has(sci)) { quarantined++; continue; }
  named++; species.add(sci); datasets.add(c[1]);
  perSpecies.set(sci, (perSpecies.get(sci) ?? 0) + 1);
  if (+c[10] >= 20) analysisGrade++;
}

console.log(`\n=== CORPUS (post-quarantine, quote-aware) ===`);
console.log(`  species           : ${species.size}`);
console.log(`  named individuals : ${named.toLocaleString()}`);
console.log(`  …with ≥20 fixes   : ${analysisGrade.toLocaleString()}  (analysis/story-grade)`);
console.log(`  unnamed (dead wt) : ${unnamed.toLocaleString()}`);
console.log(`  quarantined       : ${quarantined.toLocaleString()}`);
console.log(`  source datasets   : ${datasets.size.toLocaleString()}`);

const sorted = [...perSpecies.values()].sort((a, b) => b - a);
const total = sorted.reduce((a, b) => a + b, 0);
let acc = 0, half = 0;
for (const n of sorted) { acc += n; half++; if (acc >= total / 2) break; }
console.log(`\n  concentration: ${half} species hold half of all tracked animals`);
console.log(`  species with ≥10 individuals: ${sorted.filter((n) => n >= 10).length}`);
console.log(`  species with just 1-2       : ${sorted.filter((n) => n <= 2).length}`);
