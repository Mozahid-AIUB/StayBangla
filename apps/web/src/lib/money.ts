/**
 * Money, in one place.
 *
 * Every amount the API returns is in minor units — `pricePerNightMinor`,
 * `totalAmountMinor` — with the currency in a column beside it. A room at
 * 350000 is ৳3,500 a night, not ৳350,000, and the second is exactly the kind of
 * error a page renders without looking broken. So the conversion happens here
 * and is tested, rather than being a `/ 100` written at each call site where
 * one of them will eventually be missed.
 */

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Minor units to the major unit. Poisha to taka, cents to dollars. */
export function minorToMajor(minor: number): number {
  return minor / 100;
}

/**
 * An amount as a person reads it — sign, grouping, and paisa only when there
 * are any.
 *
 * Hotel prices are whole taka in practice, and "৳3,500.00" on every card is
 * noise. But a total that genuinely carries paisa must not be rounded away, so
 * the decimals appear when they exist.
 *
 * The currency comes from the data rather than being assumed: every price row
 * carries its own, and hardcoding ৳ would silently mislabel anything else.
 */
export function formatMoney(minor: number, currency: string): string {
  const major = minorToMajor(minor);
  const hasFraction = Math.round(major * 100) % 100 !== 0;

  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(major);

  // Intl renders BDT's narrow symbol as "BDT" or "Tk" depending on the runtime's
  // ICU data, and neither is what anyone here writes. ৳ is, so it is put in
  // rather than hoped for — this must not vary between a laptop, CI and a
  // visitor's phone.
  return currency === "BDT"
    ? formatted.replace(/^(BDT|Tk\.?|৳)\s?/, "৳")
    : formatted;
}

/**
 * The same amount in Bengali numerals, for the Bengali side of the site.
 *
 * Latin digits inside a Bengali sentence read as a switch of language
 * mid-sentence. Separators and the sign are left alone: ৳, the comma and the
 * decimal point are the same in both.
 */
export function formatMoneyBn(minor: number, currency: string): string {
  return formatMoney(minor, currency).replace(
    /[0-9]/g,
    (digit) => BENGALI_DIGITS[Number(digit)]!,
  );
}

/**
 * Nights between two calendar dates, for turning a nightly rate into a total.
 *
 * Both are `YYYY-MM-DD` in Dhaka. `Date.UTC` is used deliberately: parsing them
 * as local dates would make the count depend on the visitor's timezone, so the
 * same booking would show a different number of nights in Dhaka and in London.
 */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const [y1, m1, d1] = checkIn.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [y2, m2, d2] = checkOut.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const from = Date.UTC(y1, m1 - 1, d1);
  const to = Date.UTC(y2, m2 - 1, d2);
  return Math.round((to - from) / 86_400_000);
}
