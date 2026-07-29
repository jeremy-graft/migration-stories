import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Where Animals Go",
  description:
    "A dot-matrix Earth that breathes through the seasons, traced by real animal migrations, built from open, openly-licensed tracking data.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Body styling is owned by the hero's own stylesheet (injected by <Hero/>), so
  // the app matches the standalone artifact exactly. We only set a base bg here to
  // avoid a light flash before that stylesheet applies.
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#03090C" }}>{children}</body>
    </html>
  );
}
