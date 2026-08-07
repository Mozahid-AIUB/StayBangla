"use client";

import { useEffect, useState } from "react";
import { District } from "@staybangla/shared-types";
import { COPY, t } from "@/lib/copy";
import { localiseDigits, todayInDhaka } from "@/lib/dates";
import { ALL_DISTRICTS_IN_ORDER, DISTRICTS } from "@/lib/districts";
import { useLang } from "@/lib/lang-context";
import type { Month } from "@/lib/season";

/** How many districts the in-season line names before it stops being a line. */
const SEASON_LINE_LIMIT = 3;

/**
 * Computed once at module load, not per render. `new Date()` inside a client
 * component is evaluated on the server during SSR and again in the browser,
 * and if those two land either side of midnight on 31 December the markup
 * disagrees and React reports a hydration mismatch.
 */
const YEAR = new Date().getFullYear();

/** SSLCommerz carries these; the list is not aspirational. */
const PAYMENTS = ["bKash", "Nagad", "Rocket", "Visa", "Mastercard"] as const;

/**
 * The districts whose season is actually running today.
 *
 * The one thing in this footer that could not have been written in advance. It
 * reads the month in Dhaka and filters the same season data the district cards
 * are built from, so the line says something different in August than it does
 * in December — and it says it because the data says it, not because someone
 * remembered to update a banner.
 *
 * Empty until after mount. `todayInDhaka()` returns the same answer on the
 * server and in the browser, but the two run at different moments, and a render
 * either side of midnight in Dhaka would disagree. Below the fold, appearing a
 * frame late costs nothing; a hydration mismatch costs the console.
 */
function useDistrictsInSeason(): readonly District[] {
  const [districts, setDistricts] = useState<readonly District[]>([]);

  useEffect(() => {
    const month = Number(todayInDhaka().slice(5, 7)) as Month;
    const open = ALL_DISTRICTS_IN_ORDER.filter((district) =>
      DISTRICTS[district].season.includes(month),
    ).slice(0, SEASON_LINE_LIMIT);

    // Queued rather than set straight from the effect body, which React 19
    // flags as a cascading render.
    queueMicrotask(() => setDistricts(open));
  }, []);

  return districts;
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <li>
      <a
        href={href}
        className="inline-block py-1 text-white/60 transition-colors hover:text-white"
      >
        {children}
      </a>
    </li>
  );
}

function Column({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  const { lang } = useLang();
  return (
    <div>
      {/* h2, not h3. The page runs h1 (hero) then h2 per section, and these
          column titles were h3 with no h2 anywhere in the footer above them —
          a skipped level, which is what a screen reader's heading list uses to
          work out what contains what. */}
      <h2
        className={`mb-4 text-white ${
          // Caps and tracking are Latin devices; Bengali has neither case nor
          // room between its marks for extra spacing.
          lang === "en"
            ? "text-[0.6875rem] tracking-[0.16em] uppercase"
            : "text-sm"
        }`}
      >
        {title}
      </h2>
      <ul className="space-y-3 text-sm">{children}</ul>
      {note && <p className="mt-4 text-xs text-white/35">{note}</p>}
    </div>
  );
}

/**
 * The foot of the page.
 *
 * Dark, and deliberately the only dark band below the hero. The page opens on a
 * photograph and runs white through the middle; ending on white leaves it
 * looking like the browser ran out of content rather than the page finishing.
 *
 * Darker than --primary rather than being it. At brand strength a full-width
 * block competes with the search button, which is the one thing on the page
 * that should be the loudest indigo.
 *
 * Rebuilt after the first version read as unfinished, and it was:
 *
 * - Five of nine links were "Soon" badges, and the whole partner column was
 *   four of four. A footer padded out with what does not exist yet advertises
 *   exactly that. Those become three plain entries and one quiet sentence
 *   underneath — said once instead of four times.
 * - The destinations column was five links that all went to `#districts`. Five
 *   entries pointing at one anchor is not navigation, it is filler with the
 *   shape of navigation. Gone; the section link says the same thing honestly.
 * - It opened with a list of links, which is what a footer does when it has
 *   nothing to say. It now opens with the season line the whole site is built
 *   on, and one way back to the search.
 */
export function SiteFooter() {
  const { lang } = useLang();
  const inSeason = useDistrictsInSeason();

  return (
    <footer className="relative mt-auto overflow-hidden bg-[#141b33] text-white">
      {/* Light catching the top edge. A flat slab of colour butted against the
          white page above reads as two documents stacked; a shallow lift along
          the seam makes it one page that got darker. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(to_bottom,rgb(255_255_255/0.07)_0%,transparent_100%)]"
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16">
        {/* The closing statement. A footer that begins with a column of links
            is a footer with nothing left to say; this finishes the argument the
            page spent its whole length making. */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <p className="font-display max-w-lg text-xl leading-snug font-light sm:text-3xl">
            {t(COPY.footer.closing, lang)}
          </p>
          <a
            href="#districts"
            className="group inline-flex shrink-0 items-center gap-2 border-b border-white/25 pb-1 text-sm text-white/85 transition-colors hover:border-white hover:text-white"
          >
            {t(COPY.footer.startPlanning, lang)}
            <span
              aria-hidden
              className="transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
          </a>
        </div>

        <div className="mt-10 grid gap-10 border-t border-white/10 pt-10 sm:mt-12 sm:pt-12 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div className="max-w-sm">
            <p className="font-display text-xl font-light tracking-[0.04em]">
              StayBangla
            </p>
            <p className="mt-4 text-sm leading-relaxed text-white/55">
              {t(COPY.footer.blurb, lang)}
            </p>

            {/*
              The season, live, in the block it belongs to rather than in a row
              of its own. A visitor in August is told Sylhet and Barishal; the
              same footer in December says Saint Martin and Sundarbans, and
              nobody edits anything in between.

              min-h holds the space so the line arriving after mount does not
              shift what is under it.
            */}
            <div className="mt-6 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
              {inSeason.length > 0 && (
                <>
                  <span className="text-xs text-white/40">
                    {t(COPY.footer.bestNow, lang)}
                  </span>
                  {inSeason.map((district) => (
                    <a
                      key={district}
                      href="#districts"
                      // The marker again, and for the same reason it appears on
                      // the season bars: these are the districts whose season is
                      // running now. 6.8:1 against this footer.
                      className="font-display border-b border-[color:var(--marker)]/40 py-1 text-sm leading-6 font-light text-[color:var(--marker)] transition-colors hover:border-[color:var(--marker)]"
                    >
                      {t(DISTRICTS[district].name, lang)}
                    </a>
                  ))}
                </>
              )}
            </div>
          </div>

          <Column title={t(COPY.footer.explore, lang)}>
            <FooterLink href="#districts">
              {t(COPY.footer.destinations, lang)}
            </FooterLink>
            <FooterLink href="#rides">
              {t(COPY.footer.links.staysAndRides, lang)}
            </FooterLink>
            <FooterLink href="#why">
              {t(COPY.footer.links.whyUs, lang)}
            </FooterLink>
          </Column>

          {/* Real entries, listed plainly, with the caveat said once at the
              bottom instead of stamped on each one. */}
          <Column
            title={t(COPY.footer.partners, lang)}
            note={t(COPY.footer.partnersSoon, lang)}
          >
            <li className="text-white/40">
              {t(COPY.footer.links.listProperty, lang)}
            </li>
            <li className="text-white/40">
              {t(COPY.footer.links.addVehicle, lang)}
            </li>
            <li className="text-white/40">
              {t(COPY.footer.links.advertise, lang)}
            </li>
          </Column>
        </div>

        <div className="mt-10 flex flex-col gap-5 border-t border-white/10 pt-7 sm:mt-12 lg:flex-row lg:items-center lg:justify-between">
          {/* Wordmarks set as text, not bordered chips. A row of outlined boxes
              reads as tags; the names set plainly with room between them reads
              as a statement about how you pay. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="text-xs text-white/35">
              {t(COPY.footer.payments, lang)}
            </span>
            {PAYMENTS.map((method) => (
              <span key={method} className="text-sm text-white/70">
                {method}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/35">
            <span>{t(COPY.footer.links.terms, lang)}</span>
            <span>{t(COPY.footer.links.privacy, lang)}</span>
            <span>
              © {localiseDigits(String(YEAR), lang)} StayBangla ·{" "}
              {t(COPY.footer.madeIn, lang)}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom padding instead of the oversized wordmark that used to sit
          here. It was meant to read as a watermark at 5% white, but the
          opacity was written as text-white/[0.05] — a form Tailwind does not
          generate, so the class did nothing and the word rendered solid white
          across the whole foot of the page. Removed rather than corrected: the
          owner did not want it, and a footer does not need a second copy of a
          name that is already in it twice. */}
      <div className="h-8 sm:h-12" />
    </footer>
  );
}
