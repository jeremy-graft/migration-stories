// Pure helpers shared by the dot-matrix Earth renderers (the landing hero and the
// per-animal journey page). No DOM, no state — just the projection-adjacent math
// and the colour ramps, so both views stay visually identical.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** wrap a longitude delta into (-180, 180] */
export const wrap = (d: number) => ((d + 540) % 360) - 180;

/** bright track/ribbon colour: cold(-20°C) → warm(+30°C) */
export function tcol(t: number | null | undefined, a: number): string {
  if (t === null || t === undefined) return "rgba(150,180,190," + a + ")";
  const p = Math.max(0, Math.min(1, (t + 20) / 50));
  const r = Math.round(88 + p * (255 - 88)),
    g = Math.round(210 + p * (178 - 210)),
    b = Math.round(230 + p * (77 - 230));
  return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}

/** dark land-dot tint: cold bluish → warm brownish, all dim so tracks stay the hero */
export function landTint(t: number | null): string {
  if (t === null) return "rgb(26,44,50)";
  const p = Math.max(0, Math.min(1, (t + 35) / 65));
  return "rgb(" + Math.round(16 + p * 38) + "," + Math.round(42 - p * 4) + "," + Math.round(54 - p * 30) + ")";
}

/** dim seabed tint by depth (m): shallow shelves faint teal → abyss near the void */
export function oceanTint(dm: number): string {
  const p = Math.max(0, Math.min(1, dm / 5000));
  return "rgb(" + Math.round(12 - p * 7) + "," + Math.round(46 - p * 31) + "," + Math.round(58 - p * 38) + ")";
}

/** days-since-1970 → continuous month coordinate 0..12 (for the seasonal Earth) */
export function monthCoord(day: number): number {
  const d = new Date(day * 86400000),
    m = d.getUTCMonth();
  return m + (d.getUTCDate() - 1) / DIM[m];
}

/** stable url slug from a common name: "wandering albatross" → "wandering-albatross" */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
