// Attribution block — a CC BY obligation AND how we earn credibility.
// Every story shows species, source, DOI (linked), license badge, citation.
import { licenseLabel, type License } from "@/lib/licenses";

export interface AttributionProps {
  scientificName?: string | null;
  commonName?: string | null;
  source: string;
  datasetTitle: string;
  doi?: string | null;
  license: License;
  citation?: string | null;
  publisher?: string | null;
}

export function Attribution(p: AttributionProps) {
  const lic = licenseLabel(p.license);
  const doiUrl = p.doi ? (p.doi.startsWith("http") ? p.doi : `https://doi.org/${p.doi}`) : null;
  return (
    <aside
      style={{
        borderTop: "1px solid rgba(255,255,255,0.12)",
        marginTop: 24, paddingTop: 16, fontSize: 13, lineHeight: 1.6, opacity: 0.85,
      }}
      aria-label="Data attribution"
    >
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", opacity: 0.7, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Data &amp; attribution
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", margin: "8px 0 0" }}>
        <dt style={{ opacity: 0.6 }}>Species</dt>
        <dd style={{ margin: 0 }}>
          {p.commonName ? <>{p.commonName} · </> : null}
          <em>{p.scientificName}</em>
        </dd>
        <dt style={{ opacity: 0.6 }}>Source</dt>
        <dd style={{ margin: 0 }}>{p.datasetTitle} ({p.source})</dd>
        {p.publisher ? (<><dt style={{ opacity: 0.6 }}>Publisher</dt><dd style={{ margin: 0 }}>{p.publisher}</dd></>) : null}
        <dt style={{ opacity: 0.6 }}>License</dt>
        <dd style={{ margin: 0 }}>
          {lic.url ? <a href={lic.url} style={{ color: "#9ecbff" }}>{lic.code}</a> : lic.code}
        </dd>
        {doiUrl ? (<><dt style={{ opacity: 0.6 }}>DOI</dt><dd style={{ margin: 0 }}><a href={doiUrl} style={{ color: "#9ecbff" }}>{p.doi}</a></dd></>) : null}
      </dl>
      {p.citation ? (
        <p style={{ margin: "10px 0 0", fontSize: 12, opacity: 0.7 }}>
          <span style={{ opacity: 0.6 }}>Cite: </span>{p.citation}
        </p>
      ) : null}
    </aside>
  );
}
