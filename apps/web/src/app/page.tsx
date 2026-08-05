import { Hero } from "@/components/hero";
import { DistrictGrid } from "@/components/district-grid";
import { WhyStayBangla } from "@/components/why-staybangla";
import { VendorCta } from "@/components/vendor-cta";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <>
      <main className="flex-1">
        <Hero />
        <DistrictGrid />
        <WhyStayBangla />
        <VendorCta />
      </main>
      <SiteFooter />
    </>
  );
}
