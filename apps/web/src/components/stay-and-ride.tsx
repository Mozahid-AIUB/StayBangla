"use client";

import { District } from "@staybangla/shared-types";
import { COPY, t } from "@/lib/copy";
import { DISTRICTS } from "@/lib/districts";
import { useLang } from "@/lib/lang-context";

/**
 * Which district each pairing belongs to, in the order the copy lists them.
 *
 * The names come from DISTRICTS rather than being written into the copy a
 * second time, so a spelling fix lands once and a district removed from the
 * enum breaks the build instead of leaving a row about nowhere.
 */
const PAIRED_DISTRICTS = [
  District.RANGAMATI,
  District.SUNDARBANS,
  District.COXS_BAZAR,
] as const;

/**
 * The one thing on this page a hotel site cannot say.
 *
 * Placed straight after the district grid because that is where the question
 * arrives: someone has just decided on Sajek, and the next thing they need is
 * how anyone actually gets to Sajek. It is also the only place the page
 * delivers on "stays and rides" — the hero promises both and, before this,
 * nothing below it mentioned a vehicle again.
 *
 * A ruled list rather than a fourth grid of cards. The page already has two,
 * and the shape here is a pairing, which a row with a join in the middle
 * carries and a card does not.
 *
 * What it does not claim is as deliberate as what it does. A Booking is ROOM
 * or VEHICLE and never both, so the room and the jeep are two bookings and two
 * payments; the copy says both are listed, which is true, and stops there.
 */
export function StayAndRide() {
  const { lang } = useLang();

  return (
    <section
      id="rides"
      className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24"
    >
      <h2 className="font-display text-3xl font-light sm:text-[2.75rem]">
        {t(COPY.rides.heading, lang)}
      </h2>
      <p className="text-muted-foreground mt-4 max-w-xl text-base leading-relaxed">
        {t(COPY.rides.sub, lang)}
      </p>

      <ul className="border-border mt-10 border-t sm:mt-14">
        {COPY.rides.pairings.map((pairing, i) => {
          const district = PAIRED_DISTRICTS[i];
          return (
            <li
              key={district}
              className="border-border grid gap-x-8 gap-y-2 border-b py-6 sm:grid-cols-[9rem_1fr_auto_1fr] sm:items-baseline sm:py-8"
            >
              <span className="font-display text-xl font-light sm:text-2xl">
                {t(DISTRICTS[district].name, lang)}
              </span>
              <span className="text-base sm:text-lg">
                {t(pairing.stay, lang)}
              </span>
              {/*
                The join is the argument. aria-hidden because a screen reader
                announcing "plus" between two phrases adds nothing the sentence
                order does not already carry.
              */}
              <span
                aria-hidden
                // Not font-light. This was the only weight-300 text on the site
                // outside the display face, and carrying a whole extra Hind
                // Siliguri file — Bengali and Latin both — to draw three plus
                // signs is not a trade. At this size and this colour the
                // difference between 300 and 400 is not visible anyway.
                className="text-primary/45 text-lg leading-none sm:px-2 sm:text-xl"
              >
                +
              </span>
              <span className="text-muted-foreground text-base sm:text-lg">
                {t(pairing.ride, lang)}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground mt-6 text-sm">
        {t(COPY.rides.footnote, lang)}
      </p>
    </section>
  );
}
