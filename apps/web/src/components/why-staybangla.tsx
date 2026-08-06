"use client";

import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";

export function WhyStayBangla() {
  const { lang } = useLang();

  return (
    <section id="why" className="bg-surface border-border border-y">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <h2 className="font-display text-2xl font-light sm:text-4xl">
          {t(COPY.why.heading, lang)}
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-10">
          {COPY.why.reasons.map((reason) => (
            // Keyed on the English title: stable across a language switch,
            // where keying on the rendered string would remount every card.
            <div key={reason.title.en}>
              <div aria-hidden className="bg-primary mb-4 h-px w-12" />
              <h3 className="text-lg font-semibold">{t(reason.title, lang)}</h3>
              <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                {t(reason.body, lang)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
