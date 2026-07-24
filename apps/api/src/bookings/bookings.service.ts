import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentProviderPort } from "../common/payments/payment-provider.port";
import { BookingExpiryQueueService } from "./queue/booking-expiry-queue.service";
import { BookingRecord } from "./bookings.types";

export interface CreateBookingInput {
  bookableType: "ROOM" | "VEHICLE";
  bookableId: string;
  checkIn: string;
  checkOut: string;
  guestCount?: number;
}

const EXCLUSION_VIOLATION_SQLSTATE = "23P01";

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryQueue: BookingExpiryQueueService,
    private readonly paymentProvider: PaymentProviderPort,
  ) {}

  private validateDates(checkIn: string, checkOut: string): void {
    const inDate = new Date(checkIn);
    const outDate = new Date(checkOut);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (inDate >= outDate) {
      throw new BadRequestException("checkIn must be before checkOut");
    }
    if (inDate < today) {
      throw new BadRequestException("checkIn cannot be in the past");
    }
  }

  private nights(checkIn: string, checkOut: string): number {
    const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }

  private isExclusionViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.meta as { code?: string } | undefined)?.code ===
        EXCLUSION_VIOLATION_SQLSTATE
    );
  }

  async createBooking(
    userId: string,
    input: CreateBookingInput,
  ): Promise<BookingRecord> {
    this.validateDates(input.checkIn, input.checkOut);

    let resourceOwnerId: string;
    let pricePerUnit: number;
    let currency: string;

    if (input.bookableType === "ROOM") {
      const room = await this.prisma.room.findUnique({
        where: { id: input.bookableId },
        include: { hotel: { include: { owner: true } } },
      });
      if (!room || !room.isActive)
        throw new NotFoundException("Room not found or inactive");
      if (input.guestCount && input.guestCount > room.capacity) {
        throw new BadRequestException(`Room capacity is ${room.capacity}`);
      }
      if (room.hotel.owner.verifiedStatus !== "VERIFIED") {
        throw new ForbiddenException("This listing's owner is not verified");
      }
      resourceOwnerId = room.hotel.ownerId;
      pricePerUnit = room.pricePerNightMinor;
      currency = room.currency;
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: input.bookableId },
        include: { owner: true },
      });
      if (!vehicle || !vehicle.isActive)
        throw new NotFoundException("Vehicle not found or inactive");
      if (input.guestCount && input.guestCount > vehicle.capacity) {
        throw new BadRequestException(
          `Vehicle capacity is ${vehicle.capacity}`,
        );
      }
      if (vehicle.owner.verifiedStatus !== "VERIFIED") {
        throw new ForbiddenException("This listing's owner is not verified");
      }
      resourceOwnerId = vehicle.ownerId;
      pricePerUnit = vehicle.pricePerDayMinor;
      currency = vehicle.currency;
    }

    const totalAmountMinor =
      this.nights(input.checkIn, input.checkOut) * pricePerUnit;
    const roomId = input.bookableType === "ROOM" ? input.bookableId : null;
    const vehicleId =
      input.bookableType === "VEHICLE" ? input.bookableId : null;

    try {
      const rows = await this.prisma.$queryRaw<BookingRecord[]>(Prisma.sql`
        INSERT INTO bookings (
          id, user_id, bookable_type, room_id, vehicle_id, resource_owner_id,
          date_range, guest_count, total_amount_minor, currency, status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${userId}, ${input.bookableType}::"BookableType", ${roomId}, ${vehicleId}, ${resourceOwnerId},
          daterange(${input.checkIn}::date, ${input.checkOut}::date, '[)'),
          ${input.guestCount ?? null}, ${totalAmountMinor}, ${currency}, 'HELD', now(), now()
        )
        RETURNING id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
                  vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
                  lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
                  guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
                  currency, status, created_at AS "createdAt", updated_at AS "updatedAt"
      `);
      const booking = rows[0];
      if (!booking) {
        throw new Error("Booking insert returned no rows");
      }
      await this.expiryQueue.scheduleExpiry(booking.id);
      return booking;
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException(
          "This room/vehicle is no longer available for the selected dates",
        );
      }
      throw error;
    }
  }

  async confirmPayment(bookingId: string): Promise<BookingRecord> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException("Booking not found");

    if (booking.status === "CONFIRMED") {
      return this.toBookingRecord(booking);
    }
    if (booking.status !== "HELD") {
      throw new ConflictException(
        `Booking is ${booking.status}, cannot confirm payment`,
      );
    }

    await this.paymentProvider.charge(
      bookingId,
      booking.totalAmountMinor,
      booking.currency,
    );

    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: "HELD" },
      data: { status: "CONFIRMED" },
    });
    if (result.count === 0) {
      // Lost the race to the auto-cancel timer between our read and this update.
      throw new ConflictException(
        "Booking hold expired before payment could be confirmed",
      );
    }

    await this.expiryQueue.cancelExpiry(bookingId);
    const updated = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return this.toBookingRecord(updated);
  }

  private toBookingRecord(booking: {
    id: string;
    userId: string | null;
    bookableType: string;
    roomId: string | null;
    vehicleId: string | null;
    resourceOwnerId: string;
    guestCount: number | null;
    totalAmountMinor: number;
    currency: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): BookingRecord {
    // dateRange (Unsupported type) isn't selectable via Prisma Client — callers that
    // need checkIn/checkOut on a status-only path re-fetch via $queryRaw if required.
    return { ...booking, checkIn: "", checkOut: "" } as BookingRecord;
  }
}
