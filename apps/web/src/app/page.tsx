import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { DistrictGrid } from "@/components/district-grid";
import { AdPanel } from "@/components/ad-panel";
import { WhyStayBangla } from "@/components/why-staybangla";
import { VendorCta } from "@/components/vendor-cta";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <DistrictGrid />
        {/* Below the destinations, above the reasons to book. Next to the
            search form it would compete with the one action this page exists
            to produce; in the footer it would be unsold inventory nobody
            sees. Here the reader has picked a place and not yet booked, which
            is the moment an offer is worth anything. */}
        <AdPanel />
        <WhyStayBangla />
        <VendorCta />
      </main>
      <SiteFooter />
    </>
  );
}
