"use client";

import { District } from "@staybangla/shared-types";
import {
  DISTRICTS,
  FEATURED_DISTRICTS,
  REMAINING_DISTRICTS,
  type Terrain,
} from "@/lib/districts";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";
import { SeasonBar } from "./season-bar";

/**
 * A tone per landscape, not per card.
 *
 * Three hill districts share one green because they are one landscape — a
 * visitor scanning the grid should be able to group them without reading a
 * word. Giving each card its own colour would look busier and say less.
 *
 * Every gradient starts dark in the top-left corner, which is where the name
 * and the line sit, so white type clears AA on the base colour alone rather
 * than relying on the scrim.
 *
 * These stand in for photography, and they are built to be replaced: when the
 * curated per-district images land they become the card's background and
 * everything else — layout, scrim, type, season bar — stays exactly as it is.
 */
const TERRAIN_TONE: Record<Terrain, string> = {
  sea: "linear-gradient(155deg,#082f3e 0%,#0f5b73 58%,#12708a 100%)",
  island: "linear-gradient(155deg,#0b4a54 0%,#12727d 58%,#1a8f8f 100%)",
  hill: "linear-gradient(155deg,#07331f 0%,#10643f 60%,#1a7a4f 100%)",
  tea: "linear-gradient(155deg,#14512e 0%,#24783f 58%,#38914f 100%)",
  forest: "linear-gradient(155deg,#062718 0%,#0d4a30 62%,#145f3c 100%)",
  river: "linear-gradient(155deg,#123c4a 0%,#1d5f68 58%,#27767c 100%)",
  city: "linear-gradient(155deg,#2e2b26 0%,#4d463d 58%,#655c50 100%)",
};

/**
 * How much room each featured district gets.
 *
 * Editorial weighting, not decoration: Cox's Bazar and Sajek are where most
 * of the country's travel actually goes, and a grid of sixteen identical
 * squares says the opposite. Anything unlisted takes one cell.
 *
 * The keys follow FEATURED_DISTRICTS' order, which is also the order the
 * browser fills the grid in — change one without the other and the layout
 * rearranges itself.
 */
const SPAN: Partial<Record<District, string>> = {
  [District.COXS_BAZAR]: "col-span-2 sm:row-span-2",
  [District.RANGAMATI]: "col-span-2",
};

function DistrictCard({ district }: { district: District }) {
  const { lang } = useLang();
  const { name, blurb, season, terrain } = DISTRICTS[district];
  const large = district === District.COXS_BAZAR;

  return (
    // An article, not a link: /search does not exist yet, and a card that
    // 404s is worse than one that plainly waits. It becomes a <Link> in the
    // step that wires the search form, since both need the same route.
    <article
      className="relative min-h-[10.5rem] overflow-hidden rounded-2xl text-white sm:min-h-0"
      style={{ backgroundImage: TERRAIN_TONE[terrain] }}
    >
      {/* Darkens the lower half, where the gradient is lightest and the season
          line sits. Weighted rather than flat so the tone stays saturated
          behind the name. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_top,rgb(3_14_10/0.5)_0%,transparent_58%)]"
      />
      <div className="relative flex h-full flex-col justify-between p-4 sm:p-5">
        <div>
          <h3
            className={`font-display font-light ${
              large ? "text-2xl sm:text-4xl" : "text-lg sm:text-xl"
            }`}
          >
            {t(name, lang)}
          </h3>
          <p
            className={`mt-1.5 text-white/80 ${
              large ? "max-w-sm text-sm sm:text-base" : "text-sm"
            }`}
          >
            {t(blurb, lang)}
          </p>
        </div>
        <div className="mt-5">
          <SeasonBar months={season} />
        </div>
      </div>
    </article>
  );
}

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
      <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-relaxed">
        {t(COPY.districts.sub, lang)}
      </p>

      {/* Fixed row height on desktop so the two-row card actually spans two
          rows; on mobile the cards size to their content instead, because a
          fixed row that fits English can clip the longer Bengali line. */}
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:mt-12 sm:auto-rows-[11rem] sm:grid-cols-4 sm:gap-4">
        {FEATURED_DISTRICTS.map((district) => (
          <li key={district} className={SPAN[district] ?? ""}>
            <DistrictCard district={district} />
          </li>
        ))}
      </ul>

      {/* The remaining eight keep their names and their season data but not a
          card's worth of space — they are cities people travel through, not
          destinations they travel to. */}
      <div className="mt-10 sm:mt-12">
        <h3
          className={`text-muted-foreground text-xs ${
            // Letter-spacing and uppercase are Latin devices. Bengali has no
            // case, and spacing the glyphs out pulls apart marks that belong
            // to the letter before them.
            lang === "en" ? "tracking-[0.14em] uppercase" : "text-sm"
          }`}
        >
          {t(COPY.districts.restHeading, lang)}
        </h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {REMAINING_DISTRICTS.map((district) => (
            <li
              key={district}
              className="border-border text-foreground rounded-full border px-3.5 py-1.5 text-sm"
            >
              {t(DISTRICTS[district].name, lang)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
