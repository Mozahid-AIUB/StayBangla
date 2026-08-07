import type { Lang } from "./copy";

/**
 * A calendar date as "YYYY-MM-DD" — the day itself, with no time and no zone.
 *
 * A JavaScript Date is an instant, not a day, and every calendar bug on this
 * project has come from treating one as the other. `new Date("2026-08-06")`
 * parses as UTC midnight, which in Dhaka is already six in the morning on the
 * 6th, while `new Date(2026, 7, 6).toISOString()` in Dhaka gives back the 5th.
 * The same confusion has shipped to the API three times.
 *
 * So the day never becomes an instant here. It is a string that sorts
 * correctly, compares with `<`, and goes to the API unchanged. Where arithmetic
 * is genuinely needed the helpers below go through Date.UTC, which is a pure
 * calendar calculation with no local zone anywhere in it.
 */
export type IsoDate = string;

export interface CalendarMonth {
  year: number;
  /** 1–12, not the 0–11 that Date uses and that everyone misreads. */
  month: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Today in Bangladesh, which is the only "today" this site has an opinion
 * about.
 *
 * Not the visitor's clock: someone booking from London at 11pm is already on
 * tomorrow in Dhaka, and offering them a check-in date that has passed there is
 * how a booking gets rejected at the counter.
 *
 * Read through formatToParts rather than trusting a locale to produce ISO
 * order. `en-CA` happens to format as YYYY-MM-DD today; that is a convention,
 * not a guarantee, and it is not worth betting the calendar on.
 */
export function todayInDhaka(): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isoOf(month: CalendarMonth, day: number): IsoDate {
  return `${month.year}-${pad(month.month)}-${pad(day)}`;
}

export function monthOf(iso: IsoDate): CalendarMonth {
  const [year, month] = iso.split("-").map(Number);
  return { year, month };
}

export function addMonths(
  { year, month }: CalendarMonth,
  count: number,
): CalendarMonth {
  // Work in zero-based months so the modulo behaves, then come back.
  const total = year * 12 + (month - 1) + count;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function daysInMonth({ year, month }: CalendarMonth): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Which column the 1st falls in, 0 = Sunday. */
export function startWeekday({ year, month }: CalendarMonth): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

/**
 * Nights between two dates — the number a booking is actually priced on.
 *
 * Both ends become UTC midnights first, so the subtraction is whole days with
 * no daylight-saving or zone offset able to leave a remainder. Bangladesh has
 * no DST, but the visitor's browser might, and this runs there.
 */
export function nightsBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(ms / 86_400_000);
}

/** ISO dates sort lexicographically, which is the whole point of the format. */
export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}

export function isSameMonth(iso: IsoDate, month: CalendarMonth): boolean {
  return iso.startsWith(`${month.year}-${pad(month.month)}`);
}

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/**
 * Latin digits to Bengali ones.
 *
 * Bengali readers write dates in Bengali numerals, and a calendar that says
 * "12 ডিসেম্বর" is half-translated in the way that reads as machine output.
 * Only ever applied to text on screen — the value sent to the API stays ASCII,
 * because a server that receives "১২" has been handed a bug.
 */
export function toBengaliDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]);
}

/** Digits in the script the reader is using. */
export function localiseDigits(text: string, lang: Lang): string {
  return lang === "bn" ? toBengaliDigits(text) : text;
}

/**
 * The grid a month renders as: leading blanks for the days before the 1st,
 * then every day of the month.
 *
 * Trailing blanks are not padded in. The row simply ends, which is what a
 * printed calendar does, and it saves rendering cells that exist only to be
 * invisible.
 */
export function monthGrid(month: CalendarMonth): (number | null)[] {
  const blanks: (number | null)[] = Array.from(
    { length: startWeekday(month) },
    () => null,
  );
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => i + 1);
  return [...blanks, ...days];
}
