import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Migration Stories",
  description: "Cinematic migration stories built from open animal-tracking data.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0e1116",
          color: "#e6e8eb",
        }}
      >
        {children}
      </body>
    </html>
  );
}
