import type {
  District,
  RoomSearchResult,
  SearchQuery,
  VehicleSearchResult,
} from "@staybangla/shared-types";
import { ApiError, apiRequest } from "./api";

/**
 * What a search came back with, including how it failed.
 *
 * Rooms and vehicles are fetched together and kept apart. Two requests rather
 * than one because the API has two endpoints, and separate because the page
 * shows them as two things — someone planning a trip to Bandarban needs a
 * place to sleep *and* a jeep, not a merged list where the two compete for the
 * same attention.
 *
 * Each side carries its own error. One endpoint failing should not blank the
 * other: no rooms and no jeeps is a different message from no rooms and four
 * jeeps.
 */
export interface SearchResults {
  rooms: RoomSearchResult[];
  vehicles: VehicleSearchResult[];
  roomsError: ApiError | null;
  vehiclesError: ApiError | null;
}

/**
 * Runs both availability searches.
 *
 * Dates are optional on both endpoints now, so this is also how a district is
 * browsed: pass a city and nothing else and it answers "what is here".
 *
 * `allSettled`, not `all` — one rejection would otherwise discard the other
 * side's results, which have already arrived and are perfectly usable.
 */
export async function search(query: SearchQuery): Promise<SearchResults> {
  const roomQuery = {
    city: query.city,
    checkIn: query.checkIn,
    checkOut: query.checkOut,
  };

  // The vehicle endpoint names the same two dates differently.
  const vehicleQuery = {
    city: query.city,
    startDate: query.checkIn,
    endDate: query.checkOut,
  };

  const [rooms, vehicles] = await Promise.allSettled([
    apiRequest<RoomSearchResult[]>("/rooms/available", { query: roomQuery }),
    apiRequest<VehicleSearchResult[]>("/vehicles/available", {
      query: vehicleQuery,
    }),
  ]);

  return {
    rooms: rooms.status === "fulfilled" ? rooms.value : [],
    vehicles: vehicles.status === "fulfilled" ? vehicles.value : [],
    roomsError: rooms.status === "rejected" ? asApiError(rooms.reason) : null,
    vehiclesError:
      vehicles.status === "rejected" ? asApiError(vehicles.reason) : null,
  };
}

function asApiError(reason: unknown): ApiError {
  return reason instanceof ApiError
    ? reason
    : new ApiError(0, "Something went wrong running that search.", reason);
}

/**
 * Reads a search out of the URL.
 *
 * The URL is the state. A result page can then be shared, bookmarked, and
 * arrived at from the landing page's district cards — which link straight to
 * `/search?city=…` with no dates at all.
 *
 * Anything unrecognised is dropped rather than passed to the API, so a
 * hand-edited `?city=MARS` renders the whole country instead of a 400.
 */
export function searchFromParams(
  params: URLSearchParams,
  knownDistricts: readonly District[],
): SearchQuery {
  const city = params.get("city");
  const checkIn = params.get("checkIn");
  const checkOut = params.get("checkOut");

  const isCalendarDate = (value: string | null): value is string =>
    value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);

  // Both or neither. The API rejects half a range, and it is right to — but
  // that is a 400 the visitor did nothing to deserve if it came from a stale
  // link, so the incomplete half is dropped here instead.
  const hasBoth = isCalendarDate(checkIn) && isCalendarDate(checkOut);

  return {
    city:
      city && knownDistricts.includes(city as District)
        ? (city as District)
        : undefined,
    checkIn: hasBoth ? checkIn : undefined,
    checkOut: hasBoth ? checkOut : undefined,
  };
}

/** Turns a search back into a query string, for links and for pushing state. */
export function searchToParams(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.city) params.set("city", query.city);
  if (query.checkIn && query.checkOut) {
    params.set("checkIn", query.checkIn);
    params.set("checkOut", query.checkOut);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
