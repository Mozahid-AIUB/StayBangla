"use client";

import { useEffect, useState } from "react";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";
import { ALL_MONTHS, formatSeason, type Month } from "@/lib/season";

/**
 * The month it is right now in Bangladesh — or null until the client says so.
 *
 * Deliberately not computed during render. The server runs in UTC and the
 * visitor's browser runs in their own zone, so a month read at render time can
 * differ between the two and React reports a hydration mismatch. Rendering
 * nothing on the server and filling it in after mount is the honest version:
 * the marker appears a frame late instead of the console filling with errors.
 *
 * Asia/Dhaka rather than the visitor's clock. Someone browsing from London
 * late at night is already on tomorrow in Bangladesh, and the season this
 * answers is Bangladesh's, not theirs.
 */
function useCurrentDhakaMonth(): Month | null {
  const [month, setMonth] = useState<Month | null>(null);

  useEffect(() => {
    const dhaka = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dhaka",
      month: "numeric",
    }).format(new Date());

    // Queued rather than set straight from the effect body, which React 19
    // flags as a cascading render.
    queueMicrotask(() => setMonth(Number(dhaka) as Month));
  }, []);

  return month;
}

/**
 * Twelve segments, one per month, lit for the months the trip is worth making.
 *
 * This is the section's whole argument in one control: in Bangladesh the
 * season decides more than the destination does, and a visitor can read
 * "Saint Martin is four months of the year" faster from a bar than from a
 * sentence.
 *
 * Two facts, two channels, and they are kept apart on purpose. Brightness says
 * whether a month is in season; warmth and height say which month is now. An
 * earlier version marked the current month by making its segment taller *and*
 * left it dim when out of season, which produced a grey lump in the middle of
 * the bar that read as neither — the eye cannot tell a marker from a value when
 * both ride the same property.
 *
 * The current month is the only warm thing on an otherwise cold page, which is
 * the whole reason --marker exists. It says "you are here" without a word, and
 * it stays legible whether or not the month it lands on is in season, because
 * the opacity still carries that answer separately.
 *
 * The bar is aria-hidden and the line beneath carries the same fact in words,
 * so nothing here depends on seeing colour or shape.
 */
export function SeasonBar({ months }: { months: readonly Month[] }) {
  const { lang } = useLang();
  const now = useCurrentDhakaMonth();

  return (
    <div>
      {/* items-center, so the current month's segment grows in both directions
          and reads as a tick on a ruler rather than a bump on one edge. */}
      <div aria-hidden className="flex items-center gap-[2px]">
        {ALL_MONTHS.map((month) => {
          const lit = months.includes(month);
          const current = month === now;
          return (
            <span
              key={month}
              // Thinner and dimmer than the first pass. At 6px and 90% white
              // the bar was the loudest thing on a card — a row of heavy blocks
              // that read as a barcode and pulled the eye off the name it was
              // supposed to annotate. It is a footnote to the district, so it
              // is set like one.
              //
              // The current month keeps its full strength and its extra height:
              // it is the one segment that has something to say.
              className={`flex-1 rounded-[1px] transition-all duration-300 ${
                current ? "h-2.5" : "h-1"
              } ${
                current
                  ? lit
                    ? "bg-marker"
                    : "bg-marker/45"
                  : lit
                    ? "bg-white/65"
                    : "bg-white/12"
              }`}
            />
          );
        })}
      </div>
      <p className="mt-3 text-xs text-white/80 sm:text-[0.6875rem]">
        <span className="text-white/50">{t(COPY.season.best, lang)}</span>{" "}
        {formatSeason(months, lang)}
      </p>
    </div>
  );
}
