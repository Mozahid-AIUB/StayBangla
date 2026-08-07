"use client";

import Link from "next/link";
import type {
  RoomSearchResult,
  VehicleSearchResult,
} from "@staybangla/shared-types";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";
import { DISTRICTS } from "@/lib/districts";
import { formatMoney, formatMoneyBn, nightsBetween } from "@/lib/money";
import { mediaUrl } from "@/lib/assets";

/**
 * The same painted tones the district cards use.
 *
 * A result with no photograph gets the tone of the district it is in, so the
 * grid still reads as a set of places rather than a set of empty boxes. This is
 * the finished state for a listing without pictures — most of them, on the day
 * a vendor creates one — not a placeholder waiting to be replaced.
 */
export const TERRAIN_TONE: Record<string, string> = {
  sea: "linear-gradient(155deg,#12283a 0%,#2b5470 58%,#44768f 100%)",
  island: "linear-gradient(155deg,#153c46 0%,#2e6a72 58%,#4b8f8c 100%)",
  hill: "linear-gradient(155deg,#18301f 0%,#2f543d 60%,#4c7659 100%)",
  tea: "linear-gradient(155deg,#2c3a1a 0%,#546c2e 58%,#7e9752 100%)",
  forest: "linear-gradient(155deg,#0f1c14 0%,#1e3325 62%,#2d4634 100%)",
  river: "linear-gradient(155deg,#182e38 0%,#31555f 58%,#4d757d 100%)",
  city: "linear-gradient(155deg,#2a2724 0%,#48423a 58%,#6b6154 100%)",
};

function toneFor(city: keyof typeof DISTRICTS): string {
  return TERRAIN_TONE[DISTRICTS[city].terrain] ?? TERRAIN_TONE.city!;
}

function money(minor: number, currency: string, lang: "en" | "bn"): string {
  return lang === "bn"
    ? formatMoneyBn(minor, currency)
    : formatMoney(minor, currency);
}

export function RoomResultCard({
  room,
  checkIn,
  checkOut,
}: {
  room: RoomSearchResult;
  checkIn?: string;
  checkOut?: string;
}) {
  const { lang } = useLang();
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null;

  const search = new URLSearchParams();
  if (checkIn && checkOut) {
    search.set("checkIn", checkIn);
    search.set("checkOut", checkOut);
  }
  const query = search.toString();

  return (
    <li>
      <Link
        href={`/hotels/${room.hotelId}${query ? `?${query}` : ""}`}
        className="group block overflow-hidden rounded-2xl ring-1 ring-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        {/* 3:2, which is roughly what a photograph arrives as, so the crop takes
            the sides rather than the top of the building or the foot of the bed. */}
        <div
          className="relative aspect-[3/2] w-full bg-cover bg-center"
          style={{
            backgroundImage: room.coverObjectKey
              ? `url(${mediaUrl(`/${room.coverObjectKey}`)})`
              : toneFor(room.hotelCity),
          }}
        >
          {/* Only over a photograph. The painted tones already start dark where
              the type sits; a second wash over them reads as a smear. */}
          {room.coverObjectKey && (
            <div
              aria-hidden
              className="absolute inset-0 bg-[linear-gradient(to_top,rgb(6_9_20/0.72)_0%,rgb(6_9_20/0.28)_46%,transparent_74%)]"
            />
          )}
          <div className="absolute inset-x-0 bottom-0 p-4 text-white">
            <p className="text-[0.6875rem] tracking-[0.14em] text-white/70 uppercase">
              {t(DISTRICTS[room.hotelCity].name, lang)}
            </p>
            <h3 className="font-display mt-1 text-lg leading-tight font-light">
              {room.hotelName}
            </h3>
          </div>
        </div>

        <div className="bg-white p-4">
          <p className="text-[var(--muted-foreground)] text-sm">
            {t(COPY.results.roomType[room.roomType], lang)} ·{" "}
            {t(COPY.results.sleeps, lang).replace(
              "{n}",
              lang === "bn"
                ? String(room.capacity).replace(
                    /[0-9]/g,
                    (d) => "০১২৩৪৫৬৭৮৯"[+d]!,
                  )
                : String(room.capacity),
            )}
          </p>
          <p className="mt-2">
            <span className="text-[var(--foreground)] text-base font-medium">
              {money(room.pricePerNightMinor, room.currency, lang)}
            </span>{" "}
            <span className="text-[var(--muted-foreground)] text-sm">
              {t(COPY.results.perNight, lang)}
            </span>
          </p>
          {/* The total only appears when dates were given. Inventing one from a
              guessed length of stay would put a number on the card that the
              visitor never asked for and cannot check. */}
          {nights !== null && nights > 0 && (
            <p className="text-[var(--muted-foreground)] mt-1 text-sm">
              {money(room.pricePerNightMinor * nights, room.currency, lang)}{" "}
              {t(
                nights === 1 ? COPY.results.forNight : COPY.results.forNights,
                lang,
              ).replace(
                "{n}",
                lang === "bn"
                  ? String(nights).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[+d]!)
                  : String(nights),
              )}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

/**
 * A vehicle, with no image and no space left for one.
 *
 * The schema has HotelPhoto and RoomPhoto and nothing for vehicles, so there is
 * nothing to show. Rather than a grey rectangle with a camera icon — which
 * reads as a picture that failed — the card is typographic: the category is set
 * large, because "Jeep" is the thing a visitor is actually choosing between.
 */
export function VehicleResultCard({
  vehicle,
  checkIn,
  checkOut,
}: {
  vehicle: VehicleSearchResult;
  checkIn?: string;
  checkOut?: string;
}) {
  const { lang } = useLang();
  const days = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null;

  const search = new URLSearchParams();
  if (checkIn && checkOut) {
    search.set("checkIn", checkIn);
    search.set("checkOut", checkOut);
  }
  const query = search.toString();

  return (
    <li>
      <Link
        href={`/vehicles/${vehicle.id}${query ? `?${query}` : ""}`}
        className="group flex h-full flex-col justify-between rounded-2xl p-5 text-white ring-1 ring-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        style={{ backgroundImage: toneFor(vehicle.city) }}
      >
        <div>
          <p className="text-[0.6875rem] tracking-[0.14em] text-white/70 uppercase">
            {t(DISTRICTS[vehicle.city].name, lang)}
          </p>
          <h3 className="font-display mt-1 text-2xl leading-tight font-light">
            {t(COPY.results.vehicleCategory[vehicle.category], lang)}
          </h3>
          {vehicle.model && (
            <p className="mt-1 text-sm text-white/80">{vehicle.model}</p>
          )}
        </div>

        <div className="mt-6">
          <p className="text-sm text-white/70">
            {t(COPY.results.seats, lang).replace(
              "{n}",
              lang === "bn"
                ? String(vehicle.capacity).replace(
                    /[0-9]/g,
                    (d) => "০১২৩৪৫৬৭৮৯"[+d]!,
                  )
                : String(vehicle.capacity),
            )}
          </p>
          <p className="mt-1">
            <span className="text-base font-medium">
              {money(vehicle.pricePerDayMinor, vehicle.currency, lang)}
            </span>{" "}
            <span className="text-sm text-white/70">
              {t(COPY.results.perDay, lang)}
            </span>
          </p>
          {days !== null && days > 0 && (
            <p className="mt-1 text-sm text-white/70">
              {money(vehicle.pricePerDayMinor * days, vehicle.currency, lang)}{" "}
              {t(
                days === 1 ? COPY.results.forDay : COPY.results.forDays,
                lang,
              ).replace(
                "{n}",
                lang === "bn"
                  ? String(days).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[+d]!)
                  : String(days),
              )}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
