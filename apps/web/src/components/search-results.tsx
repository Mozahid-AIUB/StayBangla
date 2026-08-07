"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SearchQuery } from "@staybangla/shared-types";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";
import { ALL_DISTRICTS_IN_ORDER, DISTRICTS } from "@/lib/districts";
import {
  search,
  searchFromParams,
  type SearchResults as Results,
} from "@/lib/search-api";
import { SeasonBar } from "./season-bar";
import { RoomResultCard, TERRAIN_TONE, VehicleResultCard } from "./result-card";

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

function count(n: number, lang: "en" | "bn"): string {
  return lang === "bn"
    ? String(n).replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]!)
    : String(n);
}

/** A date as a reader sees it, from a `YYYY-MM-DD` string.
 *
 * Split rather than `new Date(...)`: parsing the string as a date would resolve
 * it against the visitor's timezone, and someone in London would see the day
 * before the one they picked. */
function readableDate(iso: string, lang: "en" | "bn"): string {
  const [, month, day] = iso.split("-") as [string, string, string];
  const MONTHS_EN = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const MONTHS_BN = [
    "জানু",
    "ফেব",
    "মার্চ",
    "এপ্রি",
    "মে",
    "জুন",
    "জুলা",
    "আগ",
    "সেপ্ট",
    "অক্টো",
    "নভে",
    "ডিসে",
  ];
  const index = Number(month) - 1;
  const dayText =
    lang === "bn" ? count(Number(day), "bn") : String(Number(day));
  return lang === "bn"
    ? `${dayText} ${MONTHS_BN[index]}`
    : `${dayText} ${MONTHS_EN[index]}`;
}

export function SearchResults() {
  const { lang } = useLang();
  const params = useSearchParams();
  const query: SearchQuery = searchFromParams(
    new URLSearchParams(params.toString()),
    ALL_DISTRICTS_IN_ORDER,
  );

  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by the retry button to run the search again with the same URL,
  // which a dependency on the query alone would not do.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // No setState before the await. React 19 flags a synchronous setState
    // inside an effect because it renders twice before the browser paints;
    // `loading` starts true and is only lowered on the way out, and the retry
    // button raises it from an event handler where that is fine.
    void search(query).then((next) => {
      // A visitor who changes the search before the first answer arrives would
      // otherwise see the older results overwrite the newer ones.
      if (cancelled) return;
      setResults(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // The URL is the query, so its parts are the dependency — the object is
    // rebuilt on every render and would re-run this forever.
  }, [query.city, query.checkIn, query.checkOut, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    setLoading(true);
    setResults(null);
    setAttempt((n) => n + 1);
  }, []);

  const where = query.city
    ? t(DISTRICTS[query.city].name, lang)
    : t(COPY.results.anywhere, lang);

  const when =
    query.checkIn && query.checkOut
      ? `${readableDate(query.checkIn, lang)} – ${readableDate(query.checkOut, lang)}`
      : t(COPY.results.anyDates, lang);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
      <header>
        <h1 className="font-display text-3xl leading-tight font-light sm:text-4xl">
          {where}
        </h1>
        <p className="text-[var(--muted-foreground)] mt-2 text-sm">
          {when}
          {" · "}
          <Link
            href="/"
            className="underline decoration-[var(--border)] underline-offset-4 hover:decoration-current"
          >
            {t(COPY.results.changeSearch, lang)}
          </Link>
        </p>

        {/*
          The signature of this page, and the reason it is not a generic list.

          When someone is browsing a district with no dates, the most useful
          thing on screen is not a room — it is *when to come*. The landing page
          already says the season decides more than the place does, and the API
          was changed to allow a dateless search precisely so this moment could
          exist. So the district's own months sit at the top of its results,
          the same bar as on the card they arrived from.

          It disappears once dates are chosen, because by then the question has
          been answered and the bar would be decoration.
        */}
        {/* SeasonBar carries its own "Best …" caption and is built for a dark
            card, so it sits on one here rather than being restyled — the bar a
            visitor just tapped and the bar that greets them are the same
            object, not a paler copy. */}
        {query.city && !query.checkIn && (
          <div
            className="mt-6 max-w-md rounded-2xl p-5"
            style={{
              backgroundImage: TERRAIN_TONE[DISTRICTS[query.city].terrain],
            }}
          >
            <SeasonBar months={DISTRICTS[query.city].season} />
          </div>
        )}
      </header>

      {loading && !results ? (
        <p className="text-[var(--muted-foreground)] mt-12 text-sm">
          {t(COPY.results.loading, lang)}
        </p>
      ) : (
        <>
          <Section
            heading={t(COPY.results.stays, lang)}
            error={results?.roomsError ?? null}
            errorText={t(COPY.results.staysFailed, lang)}
            emptyText={t(
              query.checkIn
                ? COPY.results.noStays
                : COPY.results.noStaysAnyDates,
              lang,
            )}
            countText={
              (results?.rooms.length ?? 0) === 1
                ? t(COPY.results.foundOneStay, lang)
                : t(COPY.results.foundStays, lang).replace(
                    "{n}",
                    count(results?.rooms.length ?? 0, lang),
                  )
            }
            isEmpty={(results?.rooms.length ?? 0) === 0}
            showClearDates={Boolean(query.checkIn)}
            city={query.city}
            onRetry={retry}
          >
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results?.rooms.map((room) => (
                <RoomResultCard
                  key={room.id}
                  room={room}
                  checkIn={query.checkIn}
                  checkOut={query.checkOut}
                />
              ))}
            </ul>
          </Section>

          <Section
            heading={t(COPY.results.rides, lang)}
            error={results?.vehiclesError ?? null}
            errorText={t(COPY.results.ridesFailed, lang)}
            emptyText={t(
              query.checkIn
                ? COPY.results.noRides
                : COPY.results.noRidesAnyDates,
              lang,
            )}
            countText={
              (results?.vehicles.length ?? 0) === 1
                ? t(COPY.results.foundOneRide, lang)
                : t(COPY.results.foundRides, lang).replace(
                    "{n}",
                    count(results?.vehicles.length ?? 0, lang),
                  )
            }
            isEmpty={(results?.vehicles.length ?? 0) === 0}
            showClearDates={Boolean(query.checkIn)}
            city={query.city}
            onRetry={retry}
          >
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results?.vehicles.map((vehicle) => (
                <VehicleResultCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  checkIn={query.checkIn}
                  checkOut={query.checkOut}
                />
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

/**
 * One half of the results — stays, or rides.
 *
 * Empty and failed are separate states with separate words. "Nothing free on
 * those dates" is the search working and the visitor can act on it by widening
 * the dates; "couldn't load" is our fault and all they can do is retry.
 * Rendering both as an empty list tells them the wrong thing half the time.
 */
function Section({
  heading,
  countText,
  isEmpty,
  emptyText,
  error,
  errorText,
  showClearDates,
  city,
  onRetry,
  children,
}: {
  heading: string;
  countText: string;
  isEmpty: boolean;
  emptyText: string;
  error: { message: string } | null;
  errorText: string;
  showClearDates: boolean;
  city?: string;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const { lang } = useLang();

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-light">{heading}</h2>
        {!error && (
          <p className="text-[var(--muted-foreground)] text-sm">{countText}</p>
        )}
      </div>

      <div className="mt-5">
        {error ? (
          <div className="border-[var(--border)] bg-[var(--surface)] rounded-2xl border p-6">
            <p className="text-[var(--foreground)] text-sm">{errorText}</p>
            <p className="text-[var(--muted-foreground)] mt-1 text-sm">
              {error.message}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="border-[var(--border)] mt-4 min-h-11 rounded-full border px-5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              {t(COPY.results.retry, lang)}
            </button>
          </div>
        ) : isEmpty ? (
          <div className="border-[var(--border)] rounded-2xl border border-dashed p-6">
            <p className="text-[var(--muted-foreground)] text-sm">
              {emptyText}
            </p>
            {showClearDates && (
              <Link
                href={city ? `/search?city=${city}` : "/search"}
                className="border-[var(--border)] mt-4 inline-flex min-h-11 items-center rounded-full border px-5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                {t(COPY.results.clearDates, lang)}
              </Link>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
