const DHAKA_OFFSET_MINUTES = 6 * 60;

function toDhakaParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const day = Number(parts.find((p) => p.type === "day")!.value);
  return { year, month, day };
}

function dhakaMidnightUtc(year: number, month: number, day: number): Date {
  // Dhaka is a fixed UTC+6 offset (no DST) — midnight Dhaka time on
  // (year, month, day) is (year, month, day) 00:00 minus 6 hours in UTC.
  const utcMillis =
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) -
    DHAKA_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMillis);
}

export function startOfDhakaDay(date: Date): Date {
  const { year, month, day } = toDhakaParts(date);
  return dhakaMidnightUtc(year, month, day);
}

/**
 * The calendar date it is right now in Bangladesh, as "YYYY-MM-DD".
 *
 * For comparing against a date the caller sent as a plain calendar date, where
 * turning either side into a Date is what goes wrong. `new Date("2026-08-06")`
 * is UTC midnight, and `new Date()` with `setHours(0,0,0,0)` is midnight in
 * whatever timezone the container happens to run in — so a comparison between
 * them is answering a question about two different days, and the answer changes
 * if someone sets TZ on the deployment.
 *
 * ISO date strings compare correctly with `<` and `>`, so callers can leave
 * both sides as strings and never construct a Date at all.
 */
export function dhakaCalendarDate(date: Date = new Date()): string {
  const { year, month, day } = toDhakaParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function endOfDhakaDay(date: Date): Date {
  const { year, month, day } = toDhakaParts(date);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return dhakaMidnightUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );
}

export function startOfDhakaWeek(date: Date): Date {
  const { year, month, day } = toDhakaParts(date);
  // Date.UTC's day-of-week is timezone-agnostic for this purpose: (year, month, day)
  // as a UTC calendar date has the same weekday as that same calendar date in any
  // timezone, so getUTCDay() here safely tells us the Dhaka weekday (0=Sun..6=Sat).
  const dhakaWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysSinceMonday = dhakaWeekday === 0 ? 6 : dhakaWeekday - 1;
  const monday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday));
  return dhakaMidnightUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
  );
}

export function endOfDhakaWeek(date: Date): Date {
  const start = startOfDhakaWeek(date);
  const { year, month, day } = toDhakaParts(start);
  const nextMonday = new Date(Date.UTC(year, month - 1, day + 7));
  return dhakaMidnightUtc(
    nextMonday.getUTCFullYear(),
    nextMonday.getUTCMonth() + 1,
    nextMonday.getUTCDate(),
  );
}

export function startOfDhakaMonth(date: Date): Date {
  const { year, month } = toDhakaParts(date);
  return dhakaMidnightUtc(year, month, 1);
}

export function endOfDhakaMonth(date: Date): Date {
  const { year, month } = toDhakaParts(date);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  return dhakaMidnightUtc(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1,
  );
}
