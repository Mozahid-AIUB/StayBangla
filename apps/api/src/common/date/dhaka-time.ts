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

export function endOfDhakaDay(date: Date): Date {
  const { year, month, day } = toDhakaParts(date);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return dhakaMidnightUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
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
