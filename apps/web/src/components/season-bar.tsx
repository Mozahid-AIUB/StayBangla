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
 * The current month stands taller than the rest, so the bar answers the
 * question people actually have — not "when is it good" but "is it good now".
 *
 * The bar is aria-hidden and the line beneath it carries the same fact in
 * words, so nothing here depends on seeing colour or shape.
 */
export function SeasonBar({ months }: { months: readonly Month[] }) {
  const { lang } = useLang();
  const now = useCurrentDhakaMonth();

  return (
    <div>
      <div aria-hidden className="flex items-end gap-[3px]">
        {ALL_MONTHS.map((month) => {
          const lit = months.includes(month);
          const current = month === now;
          return (
            <span
              key={month}
              className={`flex-1 rounded-full transition-[height] duration-300 ${
                current ? "h-2.5" : "h-1"
              } ${lit ? "bg-white/85" : "bg-white/20"}`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-white/75">
        <span className="text-white/55">{t(COPY.season.best, lang)}</span>{" "}
        {formatSeason(months, lang)}
      </p>
    </div>
  );
}
