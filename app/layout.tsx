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
// Baked in at build time from an env var, so the token never lives in the repo
// and a build without it simply ships no beacon at all (local dev included).
const CF_BEACON = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;

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
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON })}
          />
        ) : null}
      </body>
    </html>
  );
}
