// Shared fuzzy parsing for heterogeneous tracking CSVs from paper-supplement
// repositories (Zenodo, Dryad). They have no common schema, so we sniff the
// delimiter and guess which columns are lat/lon/time/individual/species, and
// validate species names against the GBIF backbone to keep junk out.

export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function detectDelim(headerLine: string): string {
  const counts = [",", "\t", ";"].map((d) => [d, headerLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

// Normalize a header cell: drop parenthetical units/directions ("Latitude(N)",
// "lat (deg)") THEN strip to alphanumerics, so unit suffixes don't break matching.
const norm = (s: string) => s.replace(/\(.*?\)/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function findCol(header: string[], match: (n: string) => boolean): number {
  return header.findIndex((h) => match(norm(h)));
}

export function detectColumns(header: string[]) {
  const lat = findCol(header, (n) => /^(decimal|gps|location|y)?lat(itude)?$/.test(n) || n === "ylat");
  const lon = findCol(header, (n) => /^(decimal|gps|location|x)?lon(g)?(itude)?$/.test(n) || n === "lng" || n === "xlon");
  // A combined datetime column is ideal; otherwise a date column (+ a separate
  // clock column captured as time2 and joined at parse time).
  const dt = findCol(header, (n) => ["timestamp", "datetime", "studylocaltimestamp", "acquisitiontime", "dateloc", "datetimeutc", "eventdate"].includes(n));
  let time = dt, time2 = -1;
  if (time < 0) {
    const dateCol = findCol(header, (n) => n === "date" || n === "day" || (n.includes("date") && !n.includes("update")));
    const clockCol = findCol(header, (n) => n === "time" || n === "gpstime" || n === "utctime" || n === "fixtime" || n === "hour");
    time = dateCol >= 0 ? dateCol : clockCol;
    if (dateCol >= 0 && clockCol >= 0 && clockCol !== dateCol) time2 = clockCol;
  }
  if (time < 0) time = findCol(header, (n) => (n.includes("date") || n.includes("time")) && !n.includes("update"));
  let id = findCol(header, (n) => ["individuallocalidentifier", "individualid", "individual", "animalid", "animal", "tagid", "taglocalidentifier", "tag", "organismid", "organism", "trackid", "birdid", "deployid", "deployment"].includes(n));
  if (id < 0) id = findCol(header, (n) => n.endsWith("id") || n === "name" || n.includes("identifier"));
  const sci = findCol(header, (n) => ["species", "scientificname", "taxon", "taxoncanonicalname", "individualtaxoncanonicalname"].includes(n));
  return { lat, lon, time, time2, id, sci };
}

// Parse a coordinate/number tolerating the European decimal comma ("53,483").
export function toNum(v: string): number {
  let s = (v ?? "").trim();
  if (s === "") return NaN;
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", "."); // comma decimal, no thousands sep
  return Number(s);
}

// Build a Date-parseable timestamp from a date column (+ optional clock column),
// normalizing the common European day-first dotted form to ISO. Anything already
// ISO-ish passes straight through for `new Date()` to handle.
export function normalizeTs(dateStr?: string, timeStr?: string): string | undefined {
  let d = (dateStr ?? "").trim();
  const t = (timeStr ?? "").trim();
  if (!d) return t || undefined;
  let m = d.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/); // DD.MM.YYYY (day-first)
  if (m && d.includes(".")) d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  else { m = d.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})$/); if (m) d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; }
  if (!t) return d;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T${t}` : `${d} ${t}`;
}

export function trackiness(name: string): number {
  return /track|gps|telemetr|argos|movement|reloc|location|\bfix/i.test(name) ? 1 : 0;
}

// binomial in title/keywords as a species fallback (e.g. "Aquila chrysaetos")
export function speciesFromText(...texts: (string | undefined)[]): string | undefined {
  for (const t of texts) {
    const m = (t || "").match(/\b([A-Z][a-z]{2,})\s([a-z]{3,})\b/);
    if (m && !/^(The|This|Data|GPS|And|For|With|From)$/.test(m[1])) return `${m[1]} ${m[2]}`;
  }
  return undefined;
}

// Validate a candidate species name against GBIF's backbone so junk like
// "Random walk" / "Range for" / "LEYE" doesn't pollute the species count.
const speciesCache = new Map<string, string | null>();
export async function validSpecies(name?: string): Promise<string | undefined> {
  const key = (name || "").trim();
  if (!key || key.length < 4) return undefined;
  if (speciesCache.has(key)) return speciesCache.get(key) ?? undefined;
  let val: string | null = null;
  try {
    const m = await (await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) })).json();
    if (m && m.matchType !== "NONE" && (m.rank === "SPECIES" || m.rank === "SUBSPECIES" || m.species)) val = m.species || m.scientificName || key;
  } catch { /* leave null */ }
  speciesCache.set(key, val);
  return val ?? undefined;
}
