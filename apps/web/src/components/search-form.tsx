"use client";

import { useId, useState } from "react";
import { District } from "@staybangla/shared-types";
import { ALL_DISTRICTS_IN_ORDER, DISTRICTS } from "@/lib/districts";
import { COPY, t } from "@/lib/copy";
import { localiseDigits } from "@/lib/dates";
import { useLang } from "@/lib/lang-context";
import { DateRangePicker, type DateRange } from "./date-range-picker";

const MIN_GUESTS = 1;
const MAX_GUESTS = 20;

/**
 * A field inside the panel: a small label with the value directly beneath it.
 *
 * The label is set in the caps-and-tracking treatment only in English. Bengali
 * has no case, and letter-spacing pulls apart the marks that hang off the
 * letter before them, so it takes size and colour instead.
 */
function Field({
  label,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { lang } = useLang();
  return (
    <div className={`min-w-0 px-4 py-3 sm:px-5 sm:py-4 ${className}`}>
      <label
        htmlFor={htmlFor}
        className={`text-muted-foreground mb-1 block ${
          lang === "en"
            ? "text-[0.625rem] tracking-[0.14em] uppercase"
            : "text-xs"
        }`}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The landing page's search panel.
 *
 * One segmented surface with hairline rules between the fields, rather than
 * four bordered boxes in a row. Four boxes is what a form builder produces:
 * every field carries its own frame, so nothing is grouped and nothing leads.
 * A single panel divided from within reads as one instrument, which is what
 * every booking site people already trust looks like.
 *
 * Submission is deliberately not wired up yet: /search does not exist, and a
 * button that 404s is worse than one that plainly says it is coming. The dates
 * are held as plain "YYYY-MM-DD" strings all the way through, so wiring the
 * query later is a matter of putting them in the URL — there is no Date object
 * anywhere to shift a booking to the wrong day on the way out.
 */
export function SearchForm() {
  const { lang } = useLang();
  const districtId = useId();

  const [district, setDistrict] = useState<District | "">("");
  const [dates, setDates] = useState<DateRange>({ from: null, to: null });
  const [guests, setGuests] = useState(2);

  const step = (by: number) =>
    setGuests((g) => Math.min(MAX_GUESTS, Math.max(MIN_GUESTS, g + by)));

  const guestWord = guests === 1 ? COPY.search.guest : COPY.search.guestsPlural;

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      aria-label={t(COPY.search.formLabel, lang)}
      className="w-full"
    >
      {/*
        overflow-visible, not hidden: the calendar hangs out of the bottom of
        this panel, and clipping it would leave the picker cut off at the
        panel's edge.
      */}
      <div className="bg-background/97 border-border/60 grid divide-y divide-[color:var(--border)] rounded-2xl border shadow-[0_24px_60px_-20px_rgb(10_14_30/0.45)] sm:grid-cols-[1.1fr_1.3fr_auto_auto] sm:divide-x sm:divide-y-0">
        <Field label={t(COPY.search.where, lang)} htmlFor={districtId}>
          <div className="relative">
            <select
              id={districtId}
              value={district}
              onChange={(e) => setDistrict(e.target.value as District | "")}
              // appearance-none and our own chevron: the native arrow is drawn
              // by the operating system, so it is a different shape and weight
              // on every machine and there is no way to make it match anything
              // else on the page.
              className="w-full cursor-pointer appearance-none truncate bg-transparent pr-6 text-base focus:outline-none"
            >
              <option value="">{t(COPY.search.anywhere, lang)}</option>
              {ALL_DISTRICTS_IN_ORDER.map((d) => (
                <option key={d} value={d}>
                  {t(DISTRICTS[d].name, lang)}
                </option>
              ))}
            </select>
            <svg
              viewBox="0 0 16 16"
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 right-0 h-3.5 w-3.5 -translate-y-1/2"
            >
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </Field>

        <Field label={t(COPY.search.when, lang)}>
          <DateRangePicker value={dates} onChange={setDates} />
        </Field>

        <Field label={t(COPY.search.guests, lang)} className="sm:w-44">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={guests <= MIN_GUESTS}
              aria-label={t(COPY.search.removeGuest, lang)}
              className="border-border text-foreground hover:border-primary hover:text-primary grid h-8 w-8 shrink-0 place-items-center rounded-full border text-lg leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-35"
            >
              −
            </button>
            {/* aria-live so the count is announced when the buttons change it —
                without it a screen-reader user presses + and hears nothing. */}
            <span aria-live="polite" className="truncate text-base">
              {localiseDigits(String(guests), lang)}{" "}
              <span className="text-muted-foreground text-sm">
                {t(guestWord, lang)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={guests >= MAX_GUESTS}
              aria-label={t(COPY.search.addGuest, lang)}
              className="border-border text-foreground hover:border-primary hover:text-primary grid h-8 w-8 shrink-0 place-items-center rounded-full border text-lg leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-35"
            >
              +
            </button>
          </div>
        </Field>

        <div className="p-3 sm:p-3">
          <button
            type="submit"
            disabled
            // Full colour even while disabled. At reduced opacity it read as a
            // dead control and dragged the whole panel down with it; the cursor
            // and the note below already say it is not live yet.
            className="bg-primary text-on-primary hover:bg-primary-hover flex h-full min-h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-base font-medium transition-colors disabled:cursor-not-allowed sm:min-h-[3.75rem]"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 shrink-0">
              <circle
                cx="7"
                cy="7"
                r="4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M10.5 10.5L14 14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            {t(COPY.search.submit, lang)}
          </button>
        </div>
      </div>

      <p className="text-muted-foreground mt-3 text-xs sm:text-white/70">
        {t(COPY.search.comingSoon, lang)}
      </p>
    </form>
  );
}
