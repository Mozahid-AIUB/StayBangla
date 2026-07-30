import {
  startOfDhakaDay,
  endOfDhakaDay,
  startOfDhakaMonth,
  endOfDhakaMonth,
} from "./dhaka-time";

describe("dhaka-time", () => {
  describe("startOfDhakaDay", () => {
    it("returns the UTC instant for 00:00 Dhaka time on the same Dhaka calendar day", () => {
      // 2026-07-30T20:00:00Z is 2026-07-31T02:00:00 in Dhaka (UTC+6)
      const input = new Date("2026-07-30T20:00:00.000Z");
      const result = startOfDhakaDay(input);
      // 2026-07-31T00:00:00 Dhaka == 2026-07-30T18:00:00Z
      expect(result.toISOString()).toBe("2026-07-30T18:00:00.000Z");
    });

    it("does not roll back a day for a time just after UTC midnight that is already the next Dhaka day", () => {
      // 2026-07-30T23:30:00Z is 2026-07-31T05:30:00 in Dhaka
      const input = new Date("2026-07-30T23:30:00.000Z");
      const result = startOfDhakaDay(input);
      expect(result.toISOString()).toBe("2026-07-30T18:00:00.000Z");
    });
  });

  describe("endOfDhakaDay", () => {
    it("returns the UTC instant just before the next Dhaka midnight", () => {
      const input = new Date("2026-07-30T20:00:00.000Z");
      const result = endOfDhakaDay(input);
      // 2026-08-01T00:00:00 Dhaka == 2026-07-31T18:00:00Z
      expect(result.toISOString()).toBe("2026-07-31T18:00:00.000Z");
    });
  });

  describe("startOfDhakaMonth", () => {
    it("returns the UTC instant for the 1st of the Dhaka calendar month at 00:00 Dhaka time", () => {
      const input = new Date("2026-07-30T20:00:00.000Z"); // 2026-07-31 Dhaka
      const result = startOfDhakaMonth(input);
      // 2026-07-01T00:00:00 Dhaka == 2026-06-30T18:00:00Z
      expect(result.toISOString()).toBe("2026-06-30T18:00:00.000Z");
    });
  });

  describe("endOfDhakaMonth", () => {
    it("returns the UTC instant just before the 1st of the next Dhaka calendar month", () => {
      const input = new Date("2026-07-30T20:00:00.000Z"); // 2026-07-31 Dhaka
      const result = endOfDhakaMonth(input);
      // 2026-08-01T00:00:00 Dhaka == 2026-07-31T18:00:00Z
      expect(result.toISOString()).toBe("2026-07-31T18:00:00.000Z");
    });
  });
});
