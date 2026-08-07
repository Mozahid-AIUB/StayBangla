import { BadRequestException } from "@nestjs/common";
import {
  assertAvailabilityRange,
  assertOptionalAvailabilityRange,
} from "./calendar-date";

/**
 * Both availability searches — rooms and vehicles — build
 * `daterange(checkIn, checkOut)` from these values, and neither validated them
 * at all. The two failures below were reachable without authenticating.
 */
describe("assertAvailabilityRange", () => {
  const rejected = (from: string, to: string) =>
    expect(() => assertAvailabilityRange(from, to)).toThrow(
      BadRequestException,
    );

  it("accepts an ordinary forward range", () => {
    expect(() =>
      assertAvailabilityRange("2026-09-01", "2026-09-03"),
    ).not.toThrow();
  });

  it("rejects a reversed range, which used to surface as a 500", () => {
    // Postgres refuses `daterange('2026-10-05','2026-10-01')` with "range
    // lower bound must be less than or equal to range upper bound". That is
    // not an HttpException, so the filter turned it into a 500 — for a request
    // both controllers already documented as a 400.
    rejected("2026-10-05", "2026-10-01");
  });

  it("rejects an equal range — the quiet one", () => {
    // An empty range overlaps nothing, so the NOT EXISTS booking check passed
    // for every room and a fully booked hotel came back entirely available.
    // Worse than the 500: it fails silently, and in the direction that sells
    // the same room twice.
    rejected("2026-10-01", "2026-10-01");
  });

  it("rejects an ISO instant where a calendar date is required", () => {
    // `${checkIn}::date` resolves an instant against the database session's
    // timezone. At 01:00 in Dhaka on 2 September — 19:00Z on the 1st — this
    // would search the night of the 1st, a night already under way, and
    // return rooms that are occupied right now.
    rejected("2026-09-01T19:00:00Z", "2026-09-03");
    rejected("2026-09-01", "2026-09-03T00:00:00.000Z");
  });

  it("rejects anything that is not a date at all", () => {
    rejected("", "2026-09-03");
    rejected("2026-9-1", "2026-09-03");
    rejected("tomorrow", "2026-09-03");
  });

  it("compares as strings, so a year boundary is not a special case", () => {
    expect(() =>
      assertAvailabilityRange("2026-12-30", "2027-01-02"),
    ).not.toThrow();
    rejected("2027-01-02", "2026-12-30");
  });
});

describe("assertOptionalAvailabilityRange", () => {
  // Browsing without dates is the point: the landing page's sixteen district
  // cards invite someone to look at a place before they have decided when to
  // go, and demanding a date first asks the two questions in the wrong order.
  it("allows both dates to be absent", () => {
    expect(() =>
      assertOptionalAvailabilityRange(undefined, undefined),
    ).not.toThrow();
  });

  it("validates the pair when both are present", () => {
    expect(() =>
      assertOptionalAvailabilityRange("2026-09-01", "2026-09-03"),
    ).not.toThrow();
    expect(() =>
      assertOptionalAvailabilityRange("2026-09-03", "2026-09-01"),
    ).toThrow(BadRequestException);
    expect(() =>
      assertOptionalAvailabilityRange("2026-09-01", "2026-09-01"),
    ).toThrow(BadRequestException);
  });

  // A half-specified range has no meaning, and silently ignoring the one that
  // was given would answer a different question than the one asked — the
  // caller would see results for no dates at all and believe they were filtered.
  it("rejects one date without the other, naming the missing one", () => {
    expect(() =>
      assertOptionalAvailabilityRange("2026-09-01", undefined),
    ).toThrow(/checkOut/);
    expect(() =>
      assertOptionalAvailabilityRange(undefined, "2026-09-03"),
    ).toThrow(/checkIn/);
  });

  it("treats an empty string as absent, since a query string sends one", () => {
    expect(() => assertOptionalAvailabilityRange("", "")).not.toThrow();
  });
});
