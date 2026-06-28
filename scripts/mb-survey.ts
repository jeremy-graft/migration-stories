// Analyze a Movebank study-list CSV (fetched once) entirely offline: license mix,
// how many are open (CC0/CC-BY) GPS studies with downloadable locations, and how
// many NEW species they'd add vs what we already have. No Movebank calls here.
//
// Usage: pnpm tsx scripts/mb-survey.ts <path-to-csv>
import "dotenv/config";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const path = process.argv[2]!;
  const rows = parseCSV(readFileSync(path, "utf8"));
  const header = rows[0];
  const col = (n: string) => header.indexOf(n);
  const cLic = col("license_type"), cLoc = col("number_of_deployed_locations"),
    cTax = col("taxon_ids"), cSens = col("sensor_type_ids"), cInd = col("number_of_individuals");

  const studies = rows.slice(1).filter((r) => r.length >= header.length);
  console.log(`Total studies: ${studies.length}\n`);

  // License distribution
  const licDist = new Map<string, number>();
  for (const r of studies) { const l = r[cLic] || "(none)"; licDist.set(l, (licDist.get(l) ?? 0) + 1); }
  console.log("license_type distribution:");
  for (const [l, n] of [...licDist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${l.padEnd(14)} ${n}`);

  // Open = CC_0 or CC_BY (strict, commercial-safe). With downloadable locations + GPS-ish.
  const isOpen = (r: string[]) => r[cLic] === "CC_0" || r[cLic] === "CC_BY";
  const hasLoc = (r: string[]) => Number(r[cLoc] || 0) > 0;
  const isGps = (r: string[]) => /gps|argos/i.test(r[cSens] || "");

  const open = studies.filter(isOpen);
  const openLoc = open.filter(hasLoc);
  const openGps = openLoc.filter(isGps);
  console.log(`\nOpen (CC0/CC-BY): ${open.length}`);
  console.log(`  …with location data: ${openLoc.length}`);
  console.log(`  …and GPS/Argos sensor: ${openGps.length}`);
  const sumInd = openGps.reduce((s, r) => s + Number(r[cInd] || 0), 0);
  const sumLoc = openGps.reduce((s, r) => s + Number(r[cLoc] || 0), 0);
  console.log(`  → ~${sumInd.toLocaleString()} individuals, ~${sumLoc.toLocaleString()} location records (pre-thinning)`);

  // Species: taxon_ids is a comma-separated list of scientific names.
  const sql = neon(process.env.DATABASE_URL!);
  const haveRows = await sql`select distinct scientific_name s from individuals where scientific_name is not null` as any;
  const have = new Set((haveRows as Array<{ s: string }>).map((r) => r.s.toLowerCase().trim()));

  const openGpsTaxa = new Set<string>();
  for (const r of openGps) for (const t of (r[cTax] || "").split(",").map((s) => s.trim()).filter(Boolean)) openGpsTaxa.add(t);
  const newTaxa = [...openGpsTaxa].filter((t) => !have.has(t.toLowerCase()));
  console.log(`\nSpecies in open GPS studies: ${openGpsTaxa.size} distinct`);
  console.log(`We already have: ${have.size}`);
  console.log(`*** NEW species reachable via Movebank: ${newTaxa.length} ***`);
  console.log(`\nSample of new species:`);
  for (const t of newTaxa.slice(0, 30)) console.log(`  ${t}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
