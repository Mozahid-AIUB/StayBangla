"use client";

import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";

/**
 * Deliberately small and low on the page. Vendor recruitment is a real goal,
 * but the landing page has one primary action — search — and a second loud
 * call to action would weaken both.
 *
 * The button is inert until the vendor sign-up flow exists.
 */
export function VendorCta() {
  const { lang } = useLang();

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="border-border flex flex-col gap-4 rounded-2xl border p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="font-display text-xl font-light sm:text-2xl">
            {t(COPY.vendor.heading, lang)}
          </h2>
          <p className="text-muted-foreground mt-2 max-w-xl text-base">
            {t(COPY.vendor.body, lang)}
          </p>
        </div>
        <button
          type="button"
          disabled
          className="border-primary text-primary h-12 shrink-0 rounded-lg border px-6 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t(COPY.vendor.cta, lang)}
        </button>
      </div>
    </section>
  );
}
