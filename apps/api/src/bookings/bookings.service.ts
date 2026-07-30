import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LedgerEntryType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentProviderPort } from "../common/payments/payment-provider.port";
import { BookingExpiryQueueService } from "./queue/booking-expiry-queue.service";
import { BookingRecord, CreateOfflineBookingInput } from "./bookings.types";

export interface CreateBookingInput {
  bookableType: "ROOM" | "VEHICLE";
  bookableId: string;
  checkIn: string;
  checkOut: string;
  guestCount?: number;
}

export interface CreateBlockInput {
  bookableType: "ROOM" | "VEHICLE";
  bookableId: string;
  startDate: string;
  endDate: string;
}

const EXCLUSION_VIOLATION_SQLSTATE = "23P01";

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryQueue: BookingExpiryQueueService,
    private readonly paymentProvider: PaymentProviderPort,
    private readonly config: ConfigService,
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

  async initiatePayment(
    callerId: string,
    bookingId: string,
  ): Promise<{ gatewayUrl: string }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException("Booking not found");
    if (booking.userId !== callerId) {
      throw new ForbiddenException("You do not own this booking");
    }
    if (booking.status !== "HELD") {
      throw new ConflictException(
        `Booking is ${booking.status}, must be HELD to initiate payment`,
      );
    }

    const session = await this.paymentProvider.createSession(
      bookingId,
      booking.totalAmountMinor,
      booking.currency,
    );
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { gatewayTranId: session.tranId },
    });

    return { gatewayUrl: session.gatewayUrl };
  }

  async confirmIfValid(bookingId: string, valId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.status !== "HELD") {
      return;
    }

    const validation = await this.paymentProvider.validateTransaction(valId);
    if (
      !validation.valid ||
      validation.amountMinor !== booking.totalAmountMinor ||
      validation.currency !== booking.currency
    ) {
      return;
    }
    if (
      validation.storeId !== null &&
      validation.storeId !== this.config.get<string>("SSLCOMMERZ_STORE_ID")
    ) {
      return;
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: booking.resourceOwnerId },
    });
    const commissionRatePercent = owner?.commissionRatePercent ?? 10;
    const platformFeeMinor = Math.floor(
      (booking.totalAmountMinor * commissionRatePercent) / 100,
    );
    const vendorOwedMinor = booking.totalAmountMinor - platformFeeMinor;

    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: "HELD" },
      data: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
        gatewayValId: valId,
        vendorOwedMinor,
      },
    });
    if (result.count === 0) {
      // Lost the race to another confirmation path (webhook vs. reconciliation
      // firing near-simultaneously, or the hold expired) between our read and
      // this update.
      return;
    }

    await this.prisma.ledgerEntry.createMany({
      data: [
        {
          bookingId,
          type: LedgerEntryType.GROSS_PAYMENT,
          amountMinor: booking.totalAmountMinor,
          ratePercentApplied: commissionRatePercent,
        },
        {
          bookingId,
          type: LedgerEntryType.PLATFORM_FEE,
          amountMinor: platformFeeMinor,
          ratePercentApplied: commissionRatePercent,
        },
        {
          bookingId,
          type: LedgerEntryType.VENDOR_OWED,
          amountMinor: vendorOwedMinor,
          ratePercentApplied: commissionRatePercent,
        },
      ],
    });
    await this.expiryQueue.cancelExpiry(bookingId);
  }

  async getPaymentStatus(
    callerId: string,
    bookingId: string,
  ): Promise<{ paymentStatus: string; gatewayTranId: string | null }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException("Booking not found");
    if (booking.userId !== callerId) {
      throw new ForbiddenException("You do not own this booking");
    }
    return {
      paymentStatus: booking.paymentStatus,
      gatewayTranId: booking.gatewayTranId,
    };
  }

  async checkout(callerId: string, bookingId: string): Promise<BookingRecord> {
    const result = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        resourceOwnerId: callerId,
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "COMPLETED" },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "Booking not found, not yours, or not in a checkout-eligible state",
      );
    }
    const updated = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return this.toBookingRecord(updated);
  }

  async cancel(
    callerId: string,
    bookingId: string,
    acknowledgeNoRefund?: boolean,
  ): Promise<BookingRecord> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (
      booking &&
      booking.userId === callerId &&
      booking.status === "CONFIRMED" &&
      booking.paymentStatus === "PAID" &&
      !acknowledgeNoRefund
    ) {
      throw new BadRequestException(
        "Cancelling a confirmed, paid booking forfeits the payment — pass acknowledgeNoRefund: true to confirm (no refund)",
      );
    }

    const result = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        userId: callerId,
        status: { in: ["HELD", "CONFIRMED"] },
      },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "Booking not found, not yours, or not cancellable",
      );
    }
    const updated = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return this.toBookingRecord(updated);
  }

  async createBlock(
    callerId: string,
    input: CreateBlockInput,
  ): Promise<BookingRecord> {
    let resourceOwnerId: string;

    if (input.bookableType === "ROOM") {
      const room = await this.prisma.room.findUnique({
        where: { id: input.bookableId },
        include: { hotel: true },
      });
      if (!room || !room.isActive)
        throw new NotFoundException("Room not found or inactive");
      resourceOwnerId = room.hotel.ownerId;
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: input.bookableId },
      });
      if (!vehicle || !vehicle.isActive)
        throw new NotFoundException("Vehicle not found or inactive");
      resourceOwnerId = vehicle.ownerId;
    }

    if (resourceOwnerId !== callerId) {
      throw new ForbiddenException("You do not own this resource");
    }

    const roomId = input.bookableType === "ROOM" ? input.bookableId : null;
    const vehicleId =
      input.bookableType === "VEHICLE" ? input.bookableId : null;

    try {
      const rows = await this.prisma.$queryRaw<BookingRecord[]>(Prisma.sql`
        INSERT INTO bookings (
          id, user_id, bookable_type, room_id, vehicle_id, resource_owner_id,
          date_range, total_amount_minor, currency, status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), NULL, ${input.bookableType}::"BookableType", ${roomId}, ${vehicleId}, ${resourceOwnerId},
          daterange(${input.startDate}::date, ${input.endDate}::date, '[)'),
          0, 'BDT', 'BLOCKED', now(), now()
        )
        RETURNING id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
                  vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
                  lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
                  guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
                  currency, status, created_at AS "createdAt", updated_at AS "updatedAt"
      `);
      const block = rows[0];
      if (!block) {
        throw new Error("Block insert returned no rows");
      }
      return block;
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException(
          "This date range overlaps an existing booking or block",
        );
      }
      throw error;
    }
  }

  async createOfflineBooking(
    callerId: string,
    input: CreateOfflineBookingInput,
  ): Promise<{
    booking: BookingRecord;
    vendorLedgerEntry: import("@prisma/client").VendorLedgerEntry;
  }> {
    this.validateDates(input.checkIn, input.checkOut);

    let resourceOwnerId: string;
    if (input.bookableType === "ROOM") {
      const room = await this.prisma.room.findUnique({
        where: { id: input.bookableId },
        include: { hotel: true },
      });
      if (!room || !room.isActive)
        throw new NotFoundException("Room not found or inactive");
      resourceOwnerId = room.hotel.ownerId;
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: input.bookableId },
      });
      if (!vehicle || !vehicle.isActive)
        throw new NotFoundException("Vehicle not found or inactive");
      resourceOwnerId = vehicle.ownerId;
    }

    if (resourceOwnerId !== callerId) {
      throw new ForbiddenException("You do not own this room/vehicle");
    }

    const roomId = input.bookableType === "ROOM" ? input.bookableId : null;
    const vehicleId =
      input.bookableType === "VEHICLE" ? input.bookableId : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<BookingRecord[]>(Prisma.sql`
          INSERT INTO bookings (
            id, user_id, bookable_type, room_id, vehicle_id, resource_owner_id,
            date_range, total_amount_minor, currency, status, source, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), NULL, ${input.bookableType}::"BookableType", ${roomId}, ${vehicleId}, ${resourceOwnerId},
            daterange(${input.checkIn}::date, ${input.checkOut}::date, '[)'),
            ${input.amountMinor}, 'BDT', 'CONFIRMED', 'OFFLINE', now(), now()
          )
          RETURNING id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
                    vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
                    lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
                    guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
                    currency, status, payment_status AS "paymentStatus", source,
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `);
        const booking = rows[0];
        if (!booking) {
          throw new Error("Offline booking insert returned no rows");
        }

        const vendorLedgerEntry = await tx.vendorLedgerEntry.create({
          data: {
            vendorId: callerId,
            roomId,
            vehicleId,
            bookingId: booking.id,
            direction: "INCOME",
            category: "WALK_IN_BOOKING",
            amountMinor: input.amountMinor,
            note: input.note ?? input.guestName ?? null,
            entryDate: new Date(input.checkIn),
          },
        });

        return { booking, vendorLedgerEntry };
      });
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException(
          "This room/vehicle is no longer available for the selected dates",
        );
      }
      throw error;
    }
  }

  async cancelOfflineBooking(
    callerId: string,
    bookingId: string,
  ): Promise<BookingRecord> {
    const result = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        resourceOwnerId: callerId,
        source: "OFFLINE",
        status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "Offline booking not found, not yours, or not cancellable",
      );
    }
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
    paymentStatus: string;
    createdAt: Date;
    updatedAt: Date;
  }): BookingRecord {
    // dateRange (Unsupported type) isn't selectable via Prisma Client — callers that
    // need checkIn/checkOut on a status-only path re-fetch via $queryRaw if required.
    return { ...booking, checkIn: "", checkOut: "" } as BookingRecord;
  }
}
