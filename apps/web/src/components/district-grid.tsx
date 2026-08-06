"use client";

import { DISTRICTS, FEATURED_DISTRICT_ORDER } from "@/lib/districts";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";

/**
 * Cards are plain articles for now. They become links into /search once that
 * page exists — the markup is shaped so that swap is a wrapper change, not a
 * rewrite.
 *
 * Each tile carries a placeholder gradient rather than a photograph; the
 * curated per-district imagery is its own step.
 */
export function DistrictGrid() {
  const { lang } = useLang();

  return (
    <section
      id="districts"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <h2 className="font-display text-2xl font-light sm:text-4xl">
        {t(COPY.districts.heading, lang)}
      </h2>
      <p className="text-muted-foreground mt-2 text-base">
        {t(COPY.districts.sub, lang)}
      </p>

      <ul className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {FEATURED_DISTRICT_ORDER.map((district) => {
          const { name, blurb } = DISTRICTS[district];
          return (
            <li key={district}>
              <article className="border-border bg-surface h-full overflow-hidden rounded-xl border">
                <div
                  aria-hidden
                  className="from-primary to-accent h-24 bg-gradient-to-br sm:h-28"
                />
                <div className="p-3 sm:p-4">
                  <h3 className="text-base font-semibold sm:text-lg">
                    {t(name, lang)}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t(blurb, lang)}
                  </p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
