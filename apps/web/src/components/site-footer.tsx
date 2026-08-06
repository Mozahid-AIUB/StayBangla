"use client";

import { useEffect, useState } from "react";
import { District } from "@staybangla/shared-types";
import { COPY, t } from "@/lib/copy";
import { localiseDigits, todayInDhaka } from "@/lib/dates";
import {
  ALL_DISTRICTS_IN_ORDER,
  DISTRICTS,
  FEATURED_DISTRICTS,
} from "@/lib/districts";
import { useLang } from "@/lib/lang-context";
import type { Month } from "@/lib/season";

/** How many districts the in-season line names before it stops being a line. */
const SEASON_LINE_LIMIT = 4;

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
 * An entry with somewhere to go. In-page anchors only for now, since those are
 * the destinations that exist.
 */
function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <li>
      <a
        href={href}
        className="text-white/65 transition-colors hover:text-white"
      >
        {children}
      </a>
    </li>
  );
}

/**
 * An entry with nowhere to go yet.
 *
 * Rendered as plain text with a marker rather than a link. A footer padded out
 * with links that 404 is the oldest tell of an unfinished site, and it costs
 * more trust than the empty column it was hiding.
 */
function FooterSoon({ children }: { children: string }) {
  const { lang } = useLang();
  return (
    <li className="flex items-center gap-2">
      <span className="text-white/35">{children}</span>
      <span className="rounded-full border border-white/15 px-1.5 py-px text-[0.5625rem] tracking-wide text-white/35 uppercase">
        {t(COPY.footer.soon, lang)}
      </span>
    </li>
  );
}

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

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
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
            ? "text-[0.625rem] tracking-[0.16em] uppercase"
            : "text-sm"
        }`}
      >
        {title}
      </h2>
      <ul className="space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

/**
 * The foot of the page.
 *
 * Dark, and deliberately the only dark band below the hero. The page opens on a
 * photograph and runs white through the middle; ending on white leaves it
 * looking like the browser ran out of content rather than the page finishing.
 * A deep band closes it.
 *
 * Darker than --primary rather than being it. At brand strength a full-width
 * block competes with the search button, which is the one thing on the page
 * that should be the loudest indigo.
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
      <div className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <p className="font-display text-2xl font-light tracking-[0.04em]">
              StayBangla
            </p>
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              {t(COPY.footer.blurb, lang)}
            </p>
          </div>

          <Column title={t(COPY.footer.destinations, lang)}>
            {/* The four people actually search for. The rest are one click
                away rather than listed out — a column of sixteen is an index,
                not a footer. */}
            {FEATURED_DISTRICTS.slice(0, 4).map((district) => (
              <FooterLink key={district} href="#districts">
                {t(DISTRICTS[district].name, lang)}
              </FooterLink>
            ))}
            <FooterLink href="#districts">
              {t(COPY.footer.allDistricts, lang)}
            </FooterLink>
          </Column>

          <Column title={t(COPY.footer.explore, lang)}>
            <FooterLink href="#rides">
              {t(COPY.footer.links.staysAndRides, lang)}
            </FooterLink>
            <FooterLink href="#why">
              {t(COPY.footer.links.whyUs, lang)}
            </FooterLink>
            <FooterSoon>{t(COPY.footer.links.help, lang)}</FooterSoon>
          </Column>

          <Column title={t(COPY.footer.partners, lang)}>
            <FooterSoon>{t(COPY.footer.links.listProperty, lang)}</FooterSoon>
            <FooterSoon>{t(COPY.footer.links.addVehicle, lang)}</FooterSoon>
            <FooterSoon>{t(COPY.footer.links.advertise, lang)}</FooterSoon>
            <FooterSoon>{t(COPY.footer.links.partnerLogin, lang)}</FooterSoon>
          </Column>
        </div>

        {/*
          The season, back one more time at the foot of the page.

          It is the device the whole site is built on — every district card
          carries its months — and repeating it here as a live sentence is what
          turns it from a graphic into a claim the site keeps making. A visitor
          in August is told Sylhet and Barishal; the same footer in December
          says Saint Martin and Sundarbans, without anyone editing it.

          min-h holds the row so the line arriving after mount does not shove
          the rest of the footer down.
        */}
        <div className="mt-14 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/10 pt-8">
          {inSeason.length > 0 && (
            <>
              <span className="text-xs text-white/45">
                {t(COPY.footer.bestNow, lang)}
              </span>
              {inSeason.map((district) => (
                <a
                  key={district}
                  href="#districts"
                  // The marker again, and for the same reason it appears on the
                  // season bars: these are the districts whose season is
                  // running *now*. One warm value, one meaning, twice on the
                  // page — 6.8:1 against this footer, comfortably past AA.
                  className="font-display border-b border-[color:var(--marker)]/45 pb-0.5 text-sm font-light text-[color:var(--marker)] transition-colors hover:border-[color:var(--marker)]"
                >
                  {t(DISTRICTS[district].name, lang)}
                </a>
              ))}
            </>
          )}
        </div>

        <div className="mt-8 border-t border-white/10 pt-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs text-white/45">
              {t(COPY.footer.payments, lang)}
            </span>
            {PAYMENTS.map((method) => (
              // Wordmarks, not logos. A logo is the brand's property and needs
              // their permission; naming a payment method you accept does not.
              <span
                key={method}
                className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/70"
              >
                {method}
              </span>
            ))}
            <span className="text-xs text-white/45">
              {t(COPY.footer.paymentNote, lang)}
            </span>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {localiseDigits(String(YEAR), lang)} StayBangla ·{" "}
            {t(COPY.footer.rights, lang)}
          </p>
          <div className="flex items-center gap-4">
            <span>{t(COPY.footer.links.terms, lang)}</span>
            <span>{t(COPY.footer.links.privacy, lang)}</span>
            <span className="text-white/30">{t(COPY.footer.madeIn, lang)}</span>
          </div>
        </div>
      </div>

      {/*
        The name, once, at the size a name is set on a building.

        Decorative and aria-hidden — the wordmark is already in the footer as
        real text above, and a screen reader reading "StayBangla" twice at the
        end of the page is noise.

        It is clipped by the footer's overflow rather than fitted inside it: a
        word sized to fit its box is a heading, a word running past the edge is
        a mark. clamp() ties it to the viewport so it holds that relationship
        from a phone to a desktop instead of being tuned for one screen.

        Very low contrast on purpose. At any strength it would compete with the
        links above it, and the point is the impression of the name rather than
        another thing to read.
      */}
      <div
        aria-hidden
        className="relative -mb-[0.14em] w-full overflow-hidden px-4 select-none sm:px-6"
      >
        <p className="font-display mx-auto max-w-6xl text-center text-[clamp(4rem,17vw,15rem)] leading-[0.8] font-light tracking-[-0.03em] text-white/[0.055] sm:text-left">
          StayBangla
        </p>
      </div>
    </footer>
  );
}
