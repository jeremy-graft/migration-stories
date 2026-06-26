// Central license policy. Commercial-safe by default: CC0 and CC BY only.
// CC BY-NC is excluded unless ALLOW_NC=true. Everything else is never ingested.
// EVERY ingestion path must filter through isCommercialSafe() before writing.

export type License = "CC0_1_0" | "CC_BY_4_0" | "CC_BY_NC_4_0" | "OTHER";

/** Normalize the many ways sources express a license into our enum. */
export function normalizeLicense(raw: string | null | undefined): License {
  if (!raw) return "OTHER";
  const s = raw.toLowerCase();
  // Handles GBIF URLs, "CC0_1_0", and Movebank's "CC_0" / "CC_BY" forms.
  if (s.includes("publicdomain/zero") || s.includes("cc0") || s.includes("cc_0") || s.includes("cc-0")) return "CC0_1_0";
  // Order matters: check NC before the generic BY.
  if (s.includes("by-nc")) return "CC_BY_NC_4_0";
  if (s.includes("licenses/by")) return "CC_BY_4_0";
  if (s.includes("cc_by_nc") || s.includes("cc by-nc")) return "CC_BY_NC_4_0";
  if (s.includes("cc_by") || s.includes("cc by")) return "CC_BY_4_0";
  return "OTHER";
}

/**
 * The single gate every ingested record must pass.
 *  - CC0 and CC BY are always commercial-safe.
 *  - CC BY-NC only if ALLOW_NC=true (explicit opt-in).
 *  - OTHER is never safe.
 */
export function isCommercialSafe(license: License): boolean {
  switch (license) {
    case "CC0_1_0":
    case "CC_BY_4_0":
      return true;
    case "CC_BY_NC_4_0":
      return process.env.ALLOW_NC === "true";
    case "OTHER":
    default:
      return false;
  }
}

/** Human-facing label + short code for the attribution UI. */
export function licenseLabel(license: License): { code: string; url: string } {
  switch (license) {
    case "CC0_1_0":
      return { code: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" };
    case "CC_BY_4_0":
      return { code: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
    case "CC_BY_NC_4_0":
      return { code: "CC BY-NC 4.0", url: "https://creativecommons.org/licenses/by-nc/4.0/" };
    default:
      return { code: "Other / unknown", url: "" };
  }
}
