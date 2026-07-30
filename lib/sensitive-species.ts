// Taxa whose precise locations should not be published, and how we mask them.
//
// Every dataset behind this project was deliberately released under an open licence
// by the people who collected it, so nothing here is a leak, and anyone determined
// can still go to the source. The goal is narrower and worth doing anyway: this site
// aggregates that data and makes it far easier to browse, and for some animals a
// ~1 km fix is enough to walk to a nest, a roost or a nesting beach. Raptors and
// vultures are persecuted by poisoning and by egg and chick collection; elephants,
// big cats, turtles and sharks are poached.
//
// HOW WE MASK, AND WHY NOT ROUNDING:
// The obvious approach is to round coordinates to ~11 km. Measured against the real
// corpus that turned out to destroy the small-range animals it most needs to protect:
// a Cooper's hawk ranging 48 km collapsed from 212 fixes to ONE distinct position,
// and 17 of 53 sensitive tracks became blocky staircases.
// So instead we TRANSLATE each species' whole track by a fixed offset of up to about
// 20 km, derived deterministically from its name. The shape, scale and timing of the
// journey survive exactly, which is what the site is actually showing, while the
// absolute position carries a ~20 km error, which is what would otherwise let someone
// find a nest. Stable across rebuilds so the map doesn't jitter between deploys.
//
// Applies to PUBLISHED payloads only; rescue/ keeps true coordinates for analysis.

/** Genus/species patterns whose published positions are masked. */
const SENSITIVE: RegExp[] = [
  // ivory
  /^Loxodonta\b/i, /^Elephas\b/i,
  // rhino horn
  /^Diceros\b/i, /^Ceratotherium\b/i, /^Rhinoceros\s/i,
  // pangolin (most-trafficked mammal)
  /^Manis\b/i, /^Smutsia\b/i, /^Phataginus\b/i,
  // big cats: trophies and parts
  /^Panthera\b/i, /^Acinonyx\b/i, /^Neofelis\b/i, /^Uncia\b/i,
  // great apes
  /^Gorilla\b/i, /^Pan\s/i, /^Pongo\b/i,
  // sea turtles: nesting beaches are the vulnerable point
  /^Caretta\b/i, /^Chelonia\b/i, /^Eretmochelys\b/i, /^Dermochelys\b/i,
  /^Lepidochelys\b/i, /^Natator\b/i,
  // sharks and rays targeted by finning
  /^Carcharodon\b/i, /^Rhincodon\b/i, /^Sphyrna\b/i, /^Isurus\b/i,
  /^Carcharhinus\b/i, /^Galeocerdo\b/i, /^Prionace\b/i, /^Cetorhinus\b/i,
  // raptors and vultures: nests and roosts, falconry trade, poisoning
  /^Aquila\b/i, /^Haliaeetus\b/i, /^Gyps\b/i, /^Torgos\b/i, /^Neophron\b/i,
  /^Gypaetus\b/i, /^Aegypius\b/i, /^Sarcoramphus\b/i, /^Falco\b/i,
  /^Circus\b/i, /^Clanga\b/i, /^Hieraaetus\b/i, /^Buteo\b/i, /^Milvus\b/i,
  /^Accipiter\b/i, /^Pandion\b/i, /^Gymnogyps\b/i, /^Vultur\b/i,
  // parrots: pet trade
  /^Anodorhynchus\b/i, /^Ara\s/i, /^Amazona\b/i, /^Cacatua\b/i,
  // other high-value targets
  /^Ursus maritimus\b/i, /^Saiga\b/i, /^Antilocapra\b/i, /^Ovis\b/i, /^Capra\b/i,
];

/** Is this a species whose published positions should be masked? */
export const isSensitive = (sci: string): boolean => SENSITIVE.some((re) => re.test(sci));

/** Largest displacement applied, in km. */
export const MASK_KM = 20;

/** Deterministic 32-bit hash, so a species always gets the same offset. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The fixed offset for a species, in degrees. Derived from the name, so it is
 * stable across rebuilds, and scaled by latitude so the displacement is a similar
 * distance on the ground everywhere rather than collapsing near the poles.
 */
export function maskOffset(sci: string, atLat: number): { dLat: number; dLon: number } {
  const h = hash(sci);
  // two independent values in [-1, 1]
  const a = ((h & 0xffff) / 0x7fff - 1);
  const b = (((h >>> 16) & 0xffff) / 0x7fff - 1);
  const degLat = MASK_KM / 111;                       // ~0.18°
  const cos = Math.max(0.15, Math.cos((atLat * Math.PI) / 180));
  return { dLat: a * degLat, dLon: (b * degLat) / cos };
}

/**
 * Publish a fix: exact for most species, displaced by a stable offset for sensitive
 * ones. Returns [lon, lat] rounded to the usual 2 dp so track shape stays smooth.
 */
export function maskPoint(lo: number, la: number, sci: string): [number, number] {
  if (!isSensitive(sci)) return [+lo.toFixed(2), +la.toFixed(2)];
  const { dLat, dLon } = maskOffset(sci, la);
  let lon = lo + dLon;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  const lat = Math.max(-89.9, Math.min(89.9, la + dLat));
  return [+lon.toFixed(2), +lat.toFixed(2)];
}
