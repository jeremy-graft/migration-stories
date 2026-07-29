// Who collected this animal's data, and under what licence.
//
// This is not decoration: CC BY REQUIRES attribution wherever the data is shown,
// and 106 of the 320 published journeys are CC BY (54 more are CC BY-NC). It is
// also the honest half of the project, the same reason the findings page publishes
// its own limits. Rendered server-side from the per-journey JSON.
import { licenseLabel, type License } from "@/lib/licenses";

export interface Attrib {
  source: string;
  title: string;
  doi: string | null;
  license: string;
  citation: string | null;
  publisher: string | null;
}

// Where each corpus came from, spelled out (our stored `source` is a short slug).
const SOURCE_LABEL: Record<string, string> = {
  gbif: "GBIF",
  movebank: "Movebank",
  movebank_repo: "Movebank",
  zenodo: "Zenodo",
  dryad: "Dryad",
  atn: "NOAA/IOOS Animal Telemetry Network",
  usgs: "USGS ScienceBase",
  pangaea: "PANGAEA",
};

export default function Provenance({ attrib }: { attrib: Attrib | null }) {
  if (!attrib) return null;
  const lic = licenseLabel(attrib.license as License);
  const isNC = attrib.license === "CC_BY_NC_4_0";
  const doiUrl = attrib.doi
    ? attrib.doi.startsWith("http")
      ? attrib.doi
      : `https://doi.org/${attrib.doi.replace(/^doi:/i, "")}`
    : null;
  const repo = SOURCE_LABEL[attrib.source] || attrib.source;
  // Several sources store the repository itself as the publisher, which would read
  // as "Collected by Movebank / Repository Movebank". Only credit a distinct one.
  const publisher =
    attrib.publisher && attrib.publisher.trim().toLowerCase() !== repo.toLowerCase() ? attrib.publisher : null;

  return (
    <aside className="prov" aria-label="Data source and licence">
      <span className="footLabel">Whose data this is</span>
      <dl>
        {attrib.title ? (
          <>
            <dt>Dataset</dt>
            <dd>{attrib.title}</dd>
          </>
        ) : null}
        {publisher ? (
          <>
            <dt>Collected by</dt>
            <dd>{publisher}</dd>
          </>
        ) : null}
        <dt>Repository</dt>
        <dd>{repo}</dd>
        <dt>Licence</dt>
        <dd>
          {lic.url ? (
            <a className={`licBadge ${isNC ? "licBadge--nc" : "licBadge--open"}`} href={lic.url} rel="license noreferrer" target="_blank">
              {lic.code}
            </a>
          ) : (
            <span className="licBadge">{lic.code}</span>
          )}
          {isNC ? <span style={{ color: "var(--muted)", marginLeft: ".6rem", fontSize: ".8rem" }}>non-commercial use only</span> : null}
        </dd>
        {doiUrl ? (
          <>
            <dt>DOI</dt>
            <dd>
              <a href={doiUrl} rel="noreferrer" target="_blank">
                {attrib.doi}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      {attrib.citation ? <p className="cite">{attrib.citation}</p> : null}
    </aside>
  );
}
