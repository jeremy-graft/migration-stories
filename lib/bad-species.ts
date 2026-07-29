// Species whose SOURCE COORDINATES are corrupt — these are not real tracking
// data and must be excluded from every analysis. Each was caught by an analysis
// producing a physically impossible result:
//
//  • The three PANGAEA freshwater fish cluster at 89.9°N — a shared FILL VALUE.
//    A South American killifish and two catfish cannot be at the North Pole.
//  • The Neotropical water snake returned a −14.6°C thermal median, i.e. its
//    fixes land in Antarctica; it lives in Central America.
//
// (Distinct from rescue/outliers.json, which holds individual teleport POINTS.)
export const BAD_SPECIES = new Set([
  "Austrolebias pelotapes",    // killifish (PANGAEA) — fixes at 89.9°N
  "Rhamdia eurycephala",       // catfish (PANGAEA)
  "Heptapterus bleekeri",      // catfish (PANGAEA)
  "Tretanorhinus nigroluteus", // water snake (Dryad) — fixes in Antarctica
  // Mislabelled, not corrupt-coordinate: the name is simply wrong for the tracks.
  "test",                      // a literal test dataset that got ingested
  "Acorypha clara",            // a grasshopper name scraped from a harrier study's abstract
]);

// Individual animals (not whole species) whose coordinates are corrupt. Quarantine
// these by individual_id — blocklisting the species would discard good data.
//
// NOTE ON WHY THIS IS A HAND-CURATED LIST: an automated "individual is in the wrong
// hemisphere for its species" rule was tried and REJECTED — it flags real biology.
// Blue whales are genuinely bipolar, and "Canis lupus" at 26°S are DINGOES
// (Canis lupus dingo), correctly labelled. Only add an entry when the location is
// physically impossible for the species, with no subspecies/population explanation.
export const BAD_INDIVIDUALS = new Set([
  // Ringed seal is Arctic-only; these two sit on the ANTARCTIC ice sheet at ~-80°
  // — a south-pole fill value, mirroring the 89.9°N one. The other 74 individuals
  // of this species are legitimately Arctic (50–70°N) and must be kept.
  "6c86ab8d-c60e-4b48-b93b-9e324b160314", // Pusa hispida "60485" — mean lat -80.1°, 94 pts
  "48e87164-8c7d-460e-bf92-68b562dc5f8c", // Pusa hispida "60486" — mean lat -79.8°, 74 pts
]);

// "scientific_name" values that are NOT a species: some source records were only
// identified to genus or family level, and that coarser label flowed straight
// through ingestion as if it were a binomial (e.g. "Larus" -> gulls, plural,
// covering species we ALSO hold individually). Caught while building the
// per-species catalog (2026-07-29): a one-word "species" entry is always this,
// plus one literal ingestion artifact ("calibration", a test/calibration record).
export const NON_SPECIES = new Set([
  "Ardeidae", "Balaenoptera", "Rallus", "Elephantidae", "Falco", "Globicephala",
  "Larus", "Mobula", "Testudinidae", "Chelonoidis", "Anatidae", "Procyon",
  "Didelphis", "calibration",
]);

// Taxonomic-synonym duplicates: the SAME animal ingested under two different
// scientific names (an old genus + its current reclassification), so it would
// otherwise appear TWICE in a per-species catalog. Keep whichever name has the
// richer track data; drop the other here.
export const SYNONYM_DUPLICATES = new Set([
  "Spatula discors",         // richer data under the older name: Anas discors
  "Aphriza virgata",         // richer data under: Calidris virgata
  "Calidris subruficollis",  // richer data under: Tryngites subruficollis
  "Pekania pennanti",        // near-identical either way; kept: Martes pennanti
]);
