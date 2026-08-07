import type { BookableType } from "./booking";
import type { BookingStatus, District, RoomType } from "./enums";

/**
 * One of a traveller's own bookings, as `GET /v1/bookings` returns it.
 *
 * Wider than `Booking`, which is what the booking machinery passes around —
 * ids, owner, amounts. A list of ids tells a traveller nothing about where they
 * are going, so these rows carry the name of the hotel or the vehicle and a
 * page renders without a request per row.
 *
 * The two halves are mutually exclusive and both nullable: a room booking has
 * the hotel fields and null vehicle fields, and the reverse. Read
 * `bookableType` to know which half is filled.
 *
 * Mirrors `TravelerBookingRow` in
 * apps/api/src/bookings/traveler-bookings.service.ts.
 */
export interface TravelerBooking {
  id: string;
  bookableType: BookableType;
  checkIn: string;
  checkOut: string;
  guestCount: number | null;
  totalAmountMinor: number;
  currency: string;
  status: BookingStatus;
  paymentStatus: string;
  /**
   * When an unpaid hold lapses, as an ISO instant — or null once the booking is
   * no longer holding anything.
   *
   * A stopwatch, not a calendar deadline: it is `BOOKING_HOLD_MINUTES` from
   * creation. Show it as remaining time and never convert it to Asia/Dhaka.
   * Check-in and check-out are Dhaka calendar days; this is not, and treating
   * it as one shifts every hold by six hours.
   */
  holdExpiresAt: string | null;
  createdAt: string;

  hotelName: string | null;
  hotelCity: District | null;
  roomType: RoomType | null;

  vehicleCategory: string | null;
  vehicleModel: string | null;
  vehicleCity: District | null;
}
