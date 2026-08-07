import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BookableType } from "./bookings.types";

/**
 * One booking, as a traveller needs to see it.
 *
 * Wider than `BookingRecord` on purpose. That type is what the booking machinery
 * passes around — ids, owner, amounts — and a list of ids tells a traveller
 * nothing about where they are going. These rows carry the name of the hotel or
 * the vehicle alongside, so a page renders without a request per row.
 *
 * The two halves are mutually exclusive and both nullable: a room booking has
 * the hotel fields and null vehicle fields, and the reverse. `bookableType`
 * says which half to read.
 */
export interface TravelerBookingRow {
  id: string;
  bookableType: BookableType;
  checkIn: string;
  checkOut: string;
  guestCount: number | null;
  totalAmountMinor: number;
  currency: string;
  status: string;
  paymentStatus: string;
  holdExpiresAt: Date | null;
  createdAt: Date;

  hotelName: string | null;
  hotelCity: string | null;
  roomType: string | null;

  vehicleCategory: string | null;
  vehicleModel: string | null;
  vehicleCity: string | null;
}

/**
 * The columns both queries return, written once.
 *
 * `date_range` is `Unsupported("daterange")` in the schema, so Prisma cannot
 * select it and every booking read in this module is raw SQL. Keeping the
 * projection in one fragment means the list and the single-row fetch cannot
 * drift into returning different shapes for the same thing.
 */
const TRAVELER_BOOKING_COLUMNS = Prisma.sql`
  b.id,
  b.bookable_type      AS "bookableType",
  lower(b.date_range)::text AS "checkIn",
  upper(b.date_range)::text AS "checkOut",
  b.guest_count        AS "guestCount",
  b.total_amount_minor AS "totalAmountMinor",
  b.currency,
  b.status::text       AS "status",
  b.payment_status::text AS "paymentStatus",
  b.hold_expires_at    AS "holdExpiresAt",
  b.created_at         AS "createdAt",
  h.name               AS "hotelName",
  h.city::text         AS "hotelCity",
  r.room_type::text    AS "roomType",
  v.category::text     AS "vehicleCategory",
  v.model              AS "vehicleModel",
  v.city::text         AS "vehicleCity"
`;

/**
 * Left joins, because a booking has exactly one of the two.
 *
 * `rooms`/`hotels` for a room booking, `vehicles` for a vehicle one — an inner
 * join on either would silently drop half the bookings, and the traveller would
 * simply not see them.
 */
const TRAVELER_BOOKING_JOINS = Prisma.sql`
  FROM bookings b
  LEFT JOIN rooms r    ON r.id = b.room_id
  LEFT JOIN hotels h   ON h.id = r.hotel_id
  LEFT JOIN vehicles v ON v.id = b.vehicle_id
`;

@Injectable()
export class TravelerBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every booking this traveller made, most recent stay first.
   *
   * Ordered by check-in rather than creation: someone opening this page is
   * looking for the trip they are about to take or just took, not for the order
   * in which they happened to press the button.
   */
  async listForTraveler(travelerId: string): Promise<TravelerBookingRow[]> {
    return this.prisma.$queryRaw<TravelerBookingRow[]>(Prisma.sql`
      SELECT ${TRAVELER_BOOKING_COLUMNS}
      ${TRAVELER_BOOKING_JOINS}
      WHERE b.user_id = ${travelerId}
      ORDER BY "checkIn" DESC, b.created_at DESC
    `);
  }

  /**
   * One booking, and only if this traveller made it.
   *
   * A booking belonging to someone else raises NotFound, not Forbidden. The two
   * are the same to the person who owns it and very different to someone
   * guessing: Forbidden confirms the id exists, which is all an enumeration
   * needs. The ownership check is part of the WHERE clause rather than a
   * comparison afterwards, so there is no version of this method that fetches
   * the row first and forgets to check.
   */
  async findOwnedOrThrow(
    travelerId: string,
    bookingId: string,
  ): Promise<TravelerBookingRow> {
    const rows = await this.prisma.$queryRaw<TravelerBookingRow[]>(Prisma.sql`
      SELECT ${TRAVELER_BOOKING_COLUMNS}
      ${TRAVELER_BOOKING_JOINS}
      WHERE b.id = ${bookingId} AND b.user_id = ${travelerId}
      LIMIT 1
    `);

    const booking = rows[0];
    if (!booking) {
      throw new NotFoundException("Booking not found");
    }
    return booking;
  }
}
