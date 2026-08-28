import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const DESC =
  "A dot-matrix Earth that breathes through the seasons, traced by real animal migrations, built from open, openly-licensed tracking data.";

export const metadata: Metadata = {
  // Absolute base so the social card resolves when the page is scraped.
  metadataBase: new URL("https://whereanimalsgo.com"),
  title: "Where Animals Go",
  description: DESC,
  icons: { icon: "/icon.svg" },
  openGraph: {
    type: "website",
    siteName: "Where Animals Go",
    title: "Where Animals Go",
    description: DESC,
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "A dark dot-matrix world map crossed by glowing animal migration tracks" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Where Animals Go",
    description: DESC,
    images: ["/og.png"],
  },
};

// Cloudflare Web Analytics: aggregate page views only. No cookies, no
// localStorage, no cross-site identifiers, nothing that follows a person between
// sites, which is why it needs no consent banner under the ePrivacy rules.
//
// The site token is committed deliberately. It is PUBLIC by design: it ships in
// the page source of every site that uses Cloudflare Web Analytics, so keeping it
// in an env var would hide it from nobody while adding a step that silently
// breaks measurement if it is ever forgotten. NEXT_PUBLIC_CF_BEACON_TOKEN still
// overrides it, so the token can be rotated without a code change.
//
// NOTE: in the Cloudflare dashboard this site must stay on "Enable with JS Snippet
// installation". The automatic mode was previously set to "excluding visitor data
// in the EU", which injected nothing for European visitors and is why the beacon
// appeared to be running while measuring almost nobody.
const CF_TOKEN_FALLBACK = "4687375b48e444f79d62e983cf317425";
// Accept a bare token OR a whole pasted <script> snippet: Cloudflare's dashboard
// hands you the full snippet, and pasting that into the env var produced a beacon
// whose "token" was the entire snippet, which Cloudflare silently rejects. Pull
// the first 32-hex id out of whatever we are given and ignore anything else.
const CF_BEACON =
  (process.env.NEXT_PUBLIC_CF_BEACON_TOKEN || "").match(/[0-9a-f]{32}/i)?.[0] || CF_TOKEN_FALLBACK;

export default function RootLayout({ children }: { children: ReactNode }) {
  // Body styling is owned by the hero's own stylesheet (injected by <Hero/>), so
  // the app matches the standalone artifact exactly. We only set a base bg here to
  // avoid a light flash before that stylesheet applies.
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#03090C" }}>
        {children}
        {CF_BEACON ? (
          <script
            type="module"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON })}
          />
        ) : null}
      </body>
    </html>
  );
}
