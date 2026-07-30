import type { Metadata } from "next";
import Link from "next/link";
import Findings from "@/components/Findings";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "What we know, and what we can't · Where Animals Go",
  description:
    "The findings from a global animal-tracking corpus, and an honest account of the questions it provably cannot answer.",
};

export default function FindingsPage() {
  return (
    <>
      <div style={{ maxWidth: "70rem", margin: "0 auto", padding: "clamp(1.5rem,4vw,2.5rem) clamp(1.1rem,4vw,2.5rem) 0" }}>
        <Link href="/" className="backLink">
          &larr; Where animals go
        </Link>
      </div>
      <Findings />
      <div style={{ maxWidth: "70rem", margin: "0 auto", padding: "0 clamp(1.1rem,4vw,2.5rem)" }}>
        <SiteFooter />
      </div>
    </>
  );
}
