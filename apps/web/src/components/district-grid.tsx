"use client";

import { District } from "@staybangla/shared-types";
import {
  DISTRICTS,
  DISTRICTS_WITH_PHOTO,
  FEATURED_DISTRICTS,
  REMAINING_DISTRICTS,
  districtPhotoPath,
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
 * The spread between the greens matters as much as the grouping. A first pass
 * put forest, hill and tea within a few degrees of each other and five of the
 * eight cards came out as the same tile: the grouping stopped meaning anything
 * because nothing was visibly outside it. So the mangrove is nearly black, the
 * hills sit in the middle, and Sreemangal takes the yellow-green a tea garden
 * actually is in late autumn.
 *
 * Every gradient starts dark in the top-left, which is where the name and the
 * line sit, so white type clears AA on the base colour alone rather than
 * relying on the scrim.
 *
 * Muted rather than saturated, and that is what stops them reading as CSS.
 * Fully saturated gradients are the thing a browser draws and a camera never
 * does — a photograph of the hills is grey-green under cloud, not the pure hue
 * a colour picker lands on. Pulling every stop back towards grey makes these
 * read as faded travel-poster ink instead of eight bright rectangles, and it
 * also stops them shouting over the indigo the interface is built in.
 *
 * These stand in for photography and are built to be replaced: when the
 * curated per-district images land they become the card's background and
 * everything else — layout, scrims, type, season bar — stays as it is.
 */
const TERRAIN_TONE: Record<Terrain, string> = {
  sea: "linear-gradient(155deg,#12283a 0%,#2b5470 58%,#44768f 100%)",
  island: "linear-gradient(155deg,#153c46 0%,#2e6a72 58%,#4b8f8c 100%)",
  hill: "linear-gradient(155deg,#18301f 0%,#2f543d 60%,#4c7659 100%)",
  tea: "linear-gradient(155deg,#2c3a1a 0%,#546c2e 58%,#7e9752 100%)",
  forest: "linear-gradient(155deg,#0f1c14 0%,#1e3325 62%,#2d4634 100%)",
  river: "linear-gradient(155deg,#182e38 0%,#31555f 58%,#4d757d 100%)",
  city: "linear-gradient(155deg,#2a2724 0%,#48423a 58%,#6b6154 100%)",
};

/**
 * How much room each featured district gets.
 *
 * Editorial weighting, not decoration: Cox's Bazar and Sajek are where most of
 * the country's travel actually goes, and a grid of sixteen identical squares
 * says the opposite. Anything unlisted takes one cell.
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
  const photo = DISTRICTS_WITH_PHOTO.includes(district)
    ? districtPhotoPath(district)
    : null;

  return (
    // h-full is load-bearing, not tidiness. The grid cell spans two rows for
    // Cox's Bazar but a block child only takes the height it needs, so without
    // this the card sat in the top half of its cell and left a hole the size of
    // another card underneath it.
    //
    // An article, not a link: /search does not exist yet, and a card that 404s
    // is worse than one that plainly waits. It becomes a <Link> in the step
    // that wires the search form, since both need the same route.
    <article
      className={`relative h-full overflow-hidden rounded-2xl text-white ring-1 ring-black/5 sm:min-h-0 ${
        // Photographed cards are taller on phones, where the grid gives every
        // card one column and the height is ours to choose.
        //
        // 11rem was set when every card was a painted tone: the type needed
        // room and nothing else did. A photograph changes both halves of that.
        // The type block runs about 105px, which in a 176px card starts around
        // 40% down — high enough to sit on the bright sky and horizon, where
        // the wash has barely begun. Measured there, the name came out at
        // 1.7:1 against white.
        //
        // It is also the wrong shape for a picture. A 176px letterbox crops a
        // landscape photograph to a strip of its middle, which is exactly the
        // band this one is palest in. The extra height buys a readable base
        // for the words and a photograph you can see at the same time.
        photo ? "min-h-[17rem]" : "min-h-[11rem]"
      }`}
      style={{ backgroundImage: TERRAIN_TONE[terrain] }}
    >
      {/* The photograph, once there is one. It sits over the tone rather than
          replacing it, so a file that fails to load leaves a finished card
          instead of a black rectangle. */}
      {photo && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${photo})` }}
        />
      )}
      {/* Light from the top right, where a sky would be. Flat gradients read as
          swatches; one source of light is the cheapest thing that makes a
          rectangle look like a surface.

          Dropped once a photograph is in place — a picture brings its own
          light, and a second one laid over it reads as a smear on the glass. */}
      {!photo && (
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(115%_85%_at_100%_0%,rgb(255_255_255/0.15)_0%,transparent_58%)]"
        />
      )}
      {/* Carries the type, which all sits low. Deeper and taller than a card
          with text at the top would need, because the name is now over the part
          of the gradient that is lightest.

          Two strengths, because the two backgrounds are not comparable. The
          painted tones are dark by construction — every one of them starts near
          black — so a light wash is enough. A photograph brings its own light
          and cannot be relied on for any of it: Cox's Bazar is pale dry sand
          across its whole lower half, and under the painted card's wash the
          white name measured 2.8:1 against it, below the 3:1 that WCAG asks
          for even at 36px, with its lightest patches down at 1.5:1.

          The deeper wash is confined to the bottom half. The picture is the
          reason to look at the card, so the part of it above the type is left
          alone — this darkens the sand the words sit on, not the view. */}
      <div
        aria-hidden
        className={
          photo
            ? "absolute inset-0 bg-[linear-gradient(to_top,rgb(6_9_20/0.88)_0%,rgb(6_9_20/0.72)_30%,rgb(6_9_20/0.46)_52%,rgb(6_9_20/0.12)_72%,transparent_88%)]"
            : "absolute inset-0 bg-[linear-gradient(to_top,rgb(6_9_20/0.62)_0%,rgb(6_9_20/0.26)_40%,transparent_72%)]"
        }
      />
      {/*
        Everything sits at the foot of the card, and the space above it is the
        point rather than a gap.

        These cards take photographs next, and a photograph wants its name along
        the bottom — it is what every travel site does, because the picture is
        the reason to look and the label is confirmation. Setting the type at the
        top now would mean moving all of it the moment the images land.

        It also resolves the two-row card: with the type at the top and the
        season pinned to the bottom, Cox's Bazar had two hundred empty pixels
        through its middle and nothing to fill them. Now the empty area is above
        the type, where it reads as the space a picture goes.
      */}
      <div className="relative flex h-full flex-col justify-end p-4 sm:p-6">
        <h3
          className={`font-display leading-tight font-light ${
            large ? "text-2xl sm:text-4xl" : "text-lg sm:text-xl"
          }`}
        >
          {t(name, lang)}
        </h3>
        <p
          className={`text-white/80 ${
            large
              ? "mt-3 max-w-xs text-sm sm:text-lg"
              : "mt-2 text-sm sm:text-[0.9375rem]"
          }`}
        >
          {t(blurb, lang)}
        </p>
        <div className={large ? "mt-7 max-w-sm" : "mt-5"}>
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
      <h2 className="font-display text-3xl font-light sm:text-[2.75rem]">
        {t(COPY.districts.heading, lang)}
      </h2>
      <p className="text-muted-foreground mt-4 max-w-xl text-base leading-relaxed">
        {t(COPY.districts.sub, lang)}
      </p>

      {/* Fixed row height on desktop so the two-row card has two rows to span;
          on mobile the cards size to their content instead, because a fixed row
          that fits the English line can clip the longer Bengali one. */}
      {/* 13rem rows, not 11rem. A single-cell card is 264x176 at 11rem, and its
          type — name, two or three lines of blurb, the season bar and its
          caption — fills about 120px of that. The words therefore start around
          a third of the way down, high enough to sit where a photograph is
          still at full strength. The extra 32px moves them into the part of
          the card the wash actually covers. */}
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:mt-14 sm:auto-rows-[13rem] sm:grid-cols-4 sm:gap-4">
        {FEATURED_DISTRICTS.map((district) => (
          <li key={district} className={SPAN[district] ?? ""}>
            <DistrictCard district={district} />
          </li>
        ))}
      </ul>

      {/* The remaining eight keep their names and their season data but not a
          card's worth of space — they are cities people travel through, not
          destinations they travel to. */}
      <div className="mt-12 sm:mt-16">
        <h3
          className={`text-muted-foreground text-xs ${
            // Letter-spacing and uppercase are Latin devices. Bengali has no
            // case, and spacing the glyphs out pulls apart marks that belong to
            // the letter before them.
            lang === "en" ? "tracking-[0.14em] uppercase" : "text-sm"
          }`}
        >
          {t(COPY.districts.restHeading, lang)}
        </h3>
        <ul className="mt-4 flex flex-wrap gap-2">
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
