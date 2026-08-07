import type { District, RoomType } from "./enums";

/**
 * A room in the availability search results.
 *
 * Flat on purpose: the hotel's name and city are carried alongside the room
 * rather than nested, because the results page shows one card per room and a
 * nested hotel would be repeated for every room in the same building.
 *
 * Mirrors `RoomAvailability` in apps/api/src/hotels/hotels.service.ts. The API
 * does not depend on this package, so the two are kept in step by hand — if you
 * change one, change the other, and the e2e tests in
 * apps/api/test/booking-availability.e2e-spec.ts assert the field names.
 */
export interface RoomSearchResult {
  id: string;
  hotelId: string;
  hotelName: string;
  hotelCity: District;
  roomType: RoomType;
  pricePerNightMinor: number;
  currency: string;
  capacity: number;
  /**
   * Object key for the card image — the room's own photograph, the hotel's, or
   * null.
   *
   * Null is a finished state, not a defect: most listings have no photograph on
   * the day they are created, and the card falls back to a painted tone the way
   * the district cards do. Resolve it through `mediaUrl()` before use; it is a
   * bucket key, not a URL.
   */
  coverObjectKey: string | null;
}

/**
 * A vehicle in the availability search results.
 *
 * No photograph field, because the schema has `HotelPhoto` and `RoomPhoto` and
 * nothing for vehicles. The card is typographic by design rather than an image
 * that failed to load.
 */
export interface VehicleSearchResult {
  id: string;
  category: "CAR" | "CNG" | "JEEP" | "BOAT";
  city: District;
  model: string | null;
  capacity: number;
  pricePerDayMinor: number;
  currency: string;
}

/**
 * What a search asks for. Every field optional — dates included.
 *
 * Dates used to be required, which put the two questions in the wrong order:
 * the landing page's district cards invite someone to look at a place, and a
 * visitor deciding where to go has not yet decided when. One date without the
 * other is a 400, because half a range has no meaning.
 */
export interface SearchQuery {
  city?: District;
  checkIn?: string;
  checkOut?: string;
}
