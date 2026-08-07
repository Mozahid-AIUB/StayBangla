import { BadRequestException } from "@nestjs/common";

/**
 * A bare calendar date — "2026-09-01" and nothing else.
 *
 * `@IsDateString()` accepts a full ISO instant just as happily, and that value
 * ends up in `${checkIn}::date`, where Postgres resolves it against the
 * session timezone. So which day a search covers would depend on a database
 * setting nobody looks at.
 *
 * Concretely, with `checkIn: new Date().toISOString()` at 01:00 in Dhaka on
 * 2 September — 19:00Z on the 1st — the search runs for the night of the 1st.
 * A night already under way. Rooms occupied tonight come back as available.
 */
export const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const CALENDAR_DATE_MESSAGE =
  "must be a calendar date in YYYY-MM-DD form";

/**
 * Validates a check-in/check-out pair for an availability search.
 *
 * Nothing validated this before, in either module, and two things fell out of
 * it — both reachable without authenticating:
 *
 * - **Reversed** (`checkIn` after `checkOut`) reached
 *   `daterange(checkIn, checkOut)`, which Postgres refuses with "range lower
 *   bound must be less than or equal to range upper bound". Not an
 *   HttpException, so it surfaced as a **500** rather than the 400 both
 *   controllers already documented.
 * - **Equal** produced an empty range, and an empty range overlaps nothing —
 *   so the `NOT EXISTS` booking check passed for every room and **a fully
 *   booked hotel came back entirely available**. That one is worse than the
 *   500: it fails quietly, and it fails in the direction that sells a room
 *   twice.
 *
 * Kept here rather than in either module because hotels and vehicles both
 * build the same range and had the same hole.
 */
export function assertAvailabilityRange(
  checkIn: string,
  checkOut: string,
): void {
  if (
    !CALENDAR_DATE_REGEX.test(checkIn) ||
    !CALENDAR_DATE_REGEX.test(checkOut)
  ) {
    throw new BadRequestException(
      `checkIn and checkOut ${CALENDAR_DATE_MESSAGE}`,
    );
  }
  // String comparison, because ISO dates sort as dates. No Date is
  // constructed, so there is no timezone for one to be wrong in.
  if (checkIn >= checkOut) {
    throw new BadRequestException("checkIn must be before checkOut");
  }
}

/**
 * The same validation for a search where dates are optional.
 *
 * Both availability searches used to require dates. That put the two questions
 * in the wrong order: the landing page's sixteen district cards invite someone
 * to look at a place, and a visitor deciding *where* to go has not yet decided
 * *when*. Browsing a district with no dates is now a search that returns
 * everything active there.
 *
 * One date without the other is refused rather than ignored. Ignoring it would
 * answer a different question than the one asked — the caller would get results
 * for no dates at all while believing they were filtered by the date they sent,
 * which is the kind of wrong that looks right.
 *
 * Empty strings count as absent. A query string carries `?checkIn=` as an empty
 * value, and treating that as a malformed date would fail a request that simply
 * left the field blank.
 *
 * @returns true when a range was supplied and should be applied.
 */
export function assertOptionalAvailabilityRange(
  checkIn: string | undefined,
  checkOut: string | undefined,
): boolean {
  const from = checkIn?.trim() ? checkIn : undefined;
  const to = checkOut?.trim() ? checkOut : undefined;

  if (!from && !to) {
    return false;
  }
  if (from && !to) {
    throw new BadRequestException("checkOut is required when checkIn is given");
  }
  if (!from && to) {
    throw new BadRequestException("checkIn is required when checkOut is given");
  }

  assertAvailabilityRange(from as string, to as string);
  return true;
}
