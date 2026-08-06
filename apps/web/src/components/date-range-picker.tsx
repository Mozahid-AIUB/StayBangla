"use client";

import { useEffect, useRef, useState } from "react";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";
import {
  addMonths,
  isoOf,
  localiseDigits,
  monthGrid,
  monthOf,
  nightsBetween,
  todayInDhaka,
  type CalendarMonth,
  type IsoDate,
} from "@/lib/dates";

export interface DateRange {
  from: IsoDate | null;
  to: IsoDate | null;
}

/**
 * Bengali or Latin, "6 Aug" either way.
 *
 * Built from COPY rather than Intl.DateTimeFormat: the browser's Bengali month
 * names are whatever its locale data happens to carry, which is not the same
 * set the rest of this site uses, and a date reading "৬ আগ" beside a season bar
 * reading "আগস্ট" is the kind of seam that makes a product feel assembled.
 */
function formatDay(iso: IsoDate, lang: "en" | "bn"): string {
  const { month } = monthOf(iso);
  const day = Number(iso.slice(8));
  const name = t(COPY.season.months[month - 1], lang);
  return `${localiseDigits(String(day), lang)} ${name}`;
}

function nightsLabel(from: IsoDate, to: IsoDate, lang: "en" | "bn"): string {
  const count = nightsBetween(from, to);
  const template = count === 1 ? COPY.calendar.night : COPY.calendar.nights;
  return t(template, lang).replace("{n}", localiseDigits(String(count), lang));
}

function MonthView({
  month,
  range,
  hovered,
  today,
  onPick,
  onHover,
}: {
  month: CalendarMonth;
  range: DateRange;
  hovered: IsoDate | null;
  today: IsoDate;
  onPick: (iso: IsoDate) => void;
  onHover: (iso: IsoDate | null) => void;
}) {
  const { lang } = useLang();

  // While only the first date is set, the hovered day stands in for the second
  // so the range fills in under the cursor. Without it a range picker gives no
  // sign of what it is about to select until after the click.
  const provisionalEnd = range.to ?? (range.from && hovered ? hovered : null);

  return (
    <div className="w-full">
      <p className="font-display mb-4 text-center text-base font-normal">
        {t(COPY.calendar.monthNames[month.month - 1], lang)}{" "}
        {localiseDigits(String(month.year), lang)}
      </p>
      <div className="text-muted-foreground mb-1 grid grid-cols-7 text-center text-[0.625rem]">
        {COPY.calendar.weekdays.map((day) => (
          <span key={day.en} className="py-1">
            {t(day, lang)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {monthGrid(month).map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;

          const iso = isoOf(month, day);
          const past = iso < today;
          const isStart = iso === range.from;
          const isEnd = iso === range.to;
          const inRange =
            range.from !== null &&
            provisionalEnd !== null &&
            iso > range.from &&
            iso < provisionalEnd;

          const selected = isStart || isEnd;

          return (
            <button
              key={iso}
              type="button"
              disabled={past}
              onClick={() => onPick(iso)}
              onMouseEnter={() => onHover(iso)}
              aria-pressed={selected}
              // The visible number is a bare digit; the full date is what a
              // screen reader needs to know which cell it has landed on.
              aria-label={`${formatDay(iso, lang)} ${localiseDigits(String(month.year), lang)}`}
              className={[
                "relative h-9 text-sm transition-colors",
                past && "text-muted-foreground/35 cursor-not-allowed",
                !past && !selected && !inRange && "hover:bg-surface",
                inRange && "bg-primary/10",
                selected && "bg-primary text-on-primary font-medium",
                // Square off the inner edges so a selected range reads as one
                // continuous band rather than two pills and a stripe.
                isStart && range.to && "rounded-l-lg",
                isEnd && "rounded-r-lg",
                !selected && "rounded-lg",
                isStart && !range.to && "rounded-lg",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {localiseDigits(String(day), lang)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Check-in and check-out in one control.
 *
 * Replaces two `<input type="date">` fields. Those were not a styling problem
 * that could be solved with CSS: the "dd----yyyy" placeholder and the little
 * calendar glyph are browser chrome, they cannot be restyled or relabelled,
 * they differ on every browser, and they are English-only — so the Bengali half
 * of the site got an English date field. A booking site's date picker is the
 * control people touch most, and that one announced that nobody had looked at
 * it.
 *
 * Two months side by side on a desktop, one on a phone. Range selection with a
 * live preview under the cursor, past dates dead, Bengali numerals when the
 * site is in Bengali.
 */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<IsoDate | null>(null);
  const [cursor, setCursor] = useState<CalendarMonth | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Today is read when the panel is opened, never during a render. The server
  // has no Dhaka clock the client agrees with to the second, and a date
  // computed on both sides is a hydration mismatch waiting for midnight.
  //
  // Done in the click handler rather than an effect keyed on `open`. The effect
  // version worked but React flags the synchronous setState inside it, and the
  // rule is right: the date is needed *because* someone opened the panel, so it
  // belongs to that event and not to a render that has to be undone afterwards.
  const [today, setToday] = useState<IsoDate | null>(null);

  const openPanel = () => {
    const now = todayInDhaka();
    setToday(now);
    // Opens on the month of the existing check-in if there is one, so reopening
    // a set range does not throw the visitor back to today.
    setCursor((current) => current ?? monthOf(value.from ?? now));
    setOpen(true);
  };

  // Click outside and Escape both close. Escape also returns focus to the
  // trigger, so a keyboard user is not dropped at the top of the document.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pick = (iso: IsoDate) => {
    // No from yet, or the range is already complete: start over.
    if (!value.from || value.to) {
      onChange({ from: iso, to: null });
      return;
    }
    // Earlier than the start: treat it as a correction rather than an error.
    // Nobody means "check out before I check in"; they mean they picked the
    // wrong first date.
    if (iso <= value.from) {
      onChange({ from: iso, to: null });
      return;
    }
    onChange({ from: value.from, to: iso });
    setHovered(null);
  };

  const summary = value.from
    ? value.to
      ? `${formatDay(value.from, lang)} — ${formatDay(value.to, lang)}`
      : formatDay(value.from, lang)
    : t(COPY.search.addDates, lang);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="w-full cursor-pointer text-left"
      >
        <span
          className={`block truncate text-base ${
            value.from ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {summary}
        </span>
        {value.from && value.to && (
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {nightsLabel(value.from, value.to, lang)}
          </span>
        )}
      </button>

      {open && today && cursor && (
        <div
          role="dialog"
          aria-label={t(COPY.calendar.label, lang)}
          // Anchored left on a phone so it cannot push the viewport sideways,
          // and centred under the field on a desktop where there is room.
          className="border-border bg-background absolute top-full left-0 z-50 mt-4 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border p-4 shadow-2xl sm:w-[34rem] sm:p-6"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, -1))}
              aria-label={t(COPY.calendar.previousMonth, lang)}
              className="hover:bg-surface grid h-9 w-9 place-items-center rounded-full transition-colors"
            >
              <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
                <path
                  d="M10 3 5 8l5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, 1))}
              aria-label={t(COPY.calendar.nextMonth, lang)}
              className="hover:bg-surface grid h-9 w-9 place-items-center rounded-full transition-colors"
            >
              <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
                <path
                  d="M6 3l5 5-5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div
            className="grid gap-8 sm:grid-cols-2"
            onMouseLeave={() => setHovered(null)}
          >
            <MonthView
              month={cursor}
              range={value}
              hovered={hovered}
              today={today}
              onPick={pick}
              onHover={setHovered}
            />
            {/* The second month is desktop-only. Two stacked months on a phone
                push the actions below the fold, and a picker whose Done button
                cannot be seen is worse than one month at a time. */}
            <div className="hidden sm:block">
              <MonthView
                month={addMonths(cursor, 1)}
                range={value}
                hovered={hovered}
                today={today}
                onPick={pick}
                onHover={setHovered}
              />
            </div>
          </div>

          <div className="border-border mt-5 flex items-center justify-between border-t pt-4">
            <span className="text-muted-foreground text-sm">
              {value.from && value.to
                ? nightsLabel(value.from, value.to, lang)
                : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onChange({ from: null, to: null })}
                className="text-muted-foreground hover:text-foreground rounded-lg px-3 py-2 text-sm underline underline-offset-4 transition-colors"
              >
                {t(COPY.calendar.clear, lang)}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="bg-primary text-on-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                {t(COPY.calendar.done, lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
