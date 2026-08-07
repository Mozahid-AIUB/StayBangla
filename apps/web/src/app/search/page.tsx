import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchResults } from "@/components/search-results";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Search — StayBangla",
  description:
    "Rooms and vehicles across sixteen districts of Bangladesh, with or without dates.",
  // Results are built from a query string and mean nothing to a crawler: every
  // combination of district and dates is a different page with the same shape.
  robots: { index: false, follow: true },
};

/**
 * Results for a search, or for a district someone is simply looking at.
 *
 * `useSearchParams` has to sit inside a Suspense boundary — with
 * `output: "export"` the page is prerendered at build time, when there is no
 * query string, and the build fails outright rather than warning if the
 * boundary is missing.
 */
export default function SearchPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="min-h-[60vh]">
        <Suspense fallback={null}>
          <SearchResults />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
