import { COPY, t, type Lang } from "./copy";

/**
 * A calendar month, 1 = January.
 *
 * A union rather than `number`: month data is written by hand across sixteen
 * districts, and `13` or `0` would otherwise sail through typecheck and render
 * an empty segment nobody notices.
 */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export const MONTHS_IN_YEAR = 12;

/**
 * Turns a set of months into the ranges a person would say out loud:
 * "Nov – Mar", or "Jun – Sep · Nov – Jan" when the good months come in two
 * separate spells.
 *
 * Two things make this more than a join:
 *
 * 1. Seasons wrap the year end. Bangladesh's travel season is winter, so
 *    almost every district's months straddle December — printing them in
 *    numeric order gives "Jan – Mar · Nov – Dec", which is the same fact
 *    stated in the least useful way.
 * 2. Some districts genuinely have two seasons. Sylhet's swamp forest needs
 *    the monsoon and Jaflong needs the dry months, so a single range would
 *    have to lie about one of them.
 *
 * Derived rather than hand-written alongside the months: a label and an array
 * maintained separately drift, and the drift is invisible because both look
 * plausible on their own.
 */
export function formatSeason(months: readonly Month[], lang: Lang): string {
  const inSeason = Array.from({ length: MONTHS_IN_YEAR }, () => false);
  for (const month of months) inSeason[month - 1] = true;

  const total = inSeason.filter(Boolean).length;
  if (total === 0) return "";
  // Guard as well as a shortcut: the run-walk below relies on there being at
  // least one month outside the season to stop at.
  if (total === MONTHS_IN_YEAR) return t(COPY.season.yearRound, lang);

  const runs: string[] = [];
  for (let i = 0; i < MONTHS_IN_YEAR; i++) {
    const previous = (i + MONTHS_IN_YEAR - 1) % MONTHS_IN_YEAR;
    // A run starts where the season does: this month is in it, the one before
    // is not. Checking the *previous* month modulo 12 is what makes a
    // December-to-January spell read as one range instead of two.
    if (!inSeason[i] || inSeason[previous]) continue;

    let end = i;
    while (inSeason[(end + 1) % MONTHS_IN_YEAR])
      end = (end + 1) % MONTHS_IN_YEAR;

    const from = t(COPY.season.months[i], lang);
    const to = t(COPY.season.months[end], lang);
    runs.push(i === end ? from : `${from} – ${to}`);
  }

  return runs.join(" · ");
}

/**
 * Whether a month is in the given season — used to light the segments of the
 * twelve-month bar on each district card.
 */
export function isInSeason(months: readonly Month[], month: Month): boolean {
  return months.includes(month);
}

/** 1…12, for rendering the bar. */
export const ALL_MONTHS: readonly Month[] = Array.from(
  { length: MONTHS_IN_YEAR },
  (_, i) => (i + 1) as Month,
);
