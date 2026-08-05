"use client";

import { useId, useState } from "react";
import { District } from "@staybangla/shared-types";
import { DISTRICTS, FEATURED_DISTRICT_ORDER } from "@/lib/districts";

/**
 * The one client component on the landing page — it holds form state.
 *
 * Submission is deliberately not wired up yet: /search does not exist, and a
 * button that 404s is worse than one that plainly says it is coming. The date
 * handling in particular must not be improvised here — Dhaka is UTC+6, and a
 * naive `toISOString()` shifts any pre-06:00 local date to the previous day.
 * That defect class has already shipped three times on this project's API, so
 * it gets its own step with its own test rather than being smuggled in with
 * layout work.
 */
export function SearchForm() {
  const districtId = useId();
  const checkInId = useId();
  const checkOutId = useId();
  const guestsId = useId();

  const [district, setDistrict] = useState<District | "">("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(2);

  return (
    <form
      // Submission lands in a later step along with /search.
      onSubmit={(e) => e.preventDefault()}
      className="bg-background/95 w-full rounded-2xl p-4 shadow-2xl backdrop-blur sm:p-5"
      aria-label="হোটেল ও গাড়ি খুঁজুন"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={districtId}
            className="text-muted-foreground text-sm font-medium"
          >
            কোথায় যাবেন
          </label>
          <select
            id={districtId}
            value={district}
            onChange={(e) => setDistrict(e.target.value as District | "")}
            className="border-border focus:border-primary focus:ring-primary/30 h-12 rounded-lg border bg-transparent px-3 text-base focus:ring-2 focus:outline-none"
          >
            <option value="">যেকোনো জায়গা</option>
            {FEATURED_DISTRICT_ORDER.map((d) => (
              <option key={d} value={d}>
                {DISTRICTS[d].name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={checkInId}
            className="text-muted-foreground text-sm font-medium"
          >
            যাওয়ার তারিখ
          </label>
          <input
            id={checkInId}
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className="border-border focus:border-primary focus:ring-primary/30 h-12 rounded-lg border bg-transparent px-3 text-base focus:ring-2 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={checkOutId}
            className="text-muted-foreground text-sm font-medium"
          >
            ফেরার তারিখ
          </label>
          <input
            id={checkOutId}
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            className="border-border focus:border-primary focus:ring-primary/30 h-12 rounded-lg border bg-transparent px-3 text-base focus:ring-2 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5 lg:w-28">
          <label
            htmlFor={guestsId}
            className="text-muted-foreground text-sm font-medium"
          >
            অতিথি
          </label>
          <input
            id={guestsId}
            type="number"
            min={1}
            max={20}
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            className="border-border focus:border-primary focus:ring-primary/30 h-12 rounded-lg border bg-transparent px-3 text-base focus:ring-2 focus:outline-none"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled
        className="bg-primary text-on-primary hover:bg-primary-hover mt-4 h-12 w-full rounded-lg text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        খুঁজুন
      </button>
      <p className="text-muted-foreground mt-2 text-center text-xs">
        অনুসন্ধান শীঘ্রই চালু হচ্ছে
      </p>
    </form>
  );
}
