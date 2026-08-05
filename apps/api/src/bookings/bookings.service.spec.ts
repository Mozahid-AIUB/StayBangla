import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BookingsService } from "./bookings.service";

// validateDates() rejects a checkIn in the past relative to the real clock,
// so test fixtures that assert past a plain "happy path" (createOfflineBooking
// below) must compute their dates relative to "now" rather than hardcode a
// literal that will eventually roll into the past and start failing for
// reasons unrelated to the behavior under test.
function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function makeRawRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "b1",
    userId: "u1",
    bookableType: "ROOM",
    roomId: "r1",
    vehicleId: null,
    resourceOwnerId: "v1",
    checkIn: "2026-09-01",
    checkOut: "2026-09-03",
    guestCount: 2,
    totalAmountMinor: 1000000,
    currency: "BDT",
    status: "HELD",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("BookingsService.createBooking", () => {
  let prisma: {
    room: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  it("rejects checkIn on/after checkOut", async () => {
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-05",
        checkOut: "2026-09-05",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a checkIn date in the past", async () => {
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2020-01-01",
        checkOut: "2020-01-02",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException when the room doesn't exist", async () => {
    prisma.room.findUnique.mockResolvedValue(null);
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "missing",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws BadRequestException when guestCount exceeds room capacity", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: { ownerId: "v1", owner: { verifiedStatus: "VERIFIED" } },
    });
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
        guestCount: 5,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws ForbiddenException when the resource owner isn't verified", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: { ownerId: "v1", owner: { verifiedStatus: "PENDING" } },
    });
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("creates a HELD booking with totalAmountMinor computed from nights * price", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: {
        ownerId: "v1",
        owner: { verifiedStatus: "VERIFIED", suspendedAt: null },
      },
    });
    prisma.$queryRaw.mockResolvedValue([
      makeRawRow({ totalAmountMinor: 1000000 }),
    ]);

    const result = await service.createBooking("u1", {
      bookableType: "ROOM",
      bookableId: "r1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
      guestCount: 2,
    });

    expect(result.totalAmountMinor).toBe(1000000); // 2 nights * 500000
    expect(result.status).toBe("HELD");
  });

  it("translates a Postgres exclusion-constraint violation into ConflictException (409)", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: {
        ownerId: "v1",
        owner: { verifiedStatus: "VERIFIED", suspendedAt: null },
      },
    });
    const pgError = Object.assign(
      new Error("conflicting key value violates exclusion constraint"),
      { code: "23P01" },
    );
    prisma.$queryRaw.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(pgError.message, {
        code: "P2010",
        clientVersion: "test",
        meta: { code: "23P01" },
      }),
    );

    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("rethrows a non-exclusion-violation error from the insert unchanged", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: {
        ownerId: "v1",
        owner: { verifiedStatus: "VERIFIED", suspendedAt: null },
      },
    });
    prisma.$queryRaw.mockRejectedValue(new Error("connection reset"));

    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow("connection reset");
  });

  it("throws when the insert unexpectedly returns no rows", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: {
        ownerId: "v1",
        owner: { verifiedStatus: "VERIFIED", suspendedAt: null },
      },
    });
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow("Booking insert returned no rows");
  });

  it("rejects a booking on a room whose owner is suspended", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "room1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 5000,
      currency: "BDT",
      hotel: {
        ownerId: "vendor1",
        owner: { verifiedStatus: "VERIFIED", suspendedAt: new Date() },
      },
    });

    await expect(
      service.createBooking("traveler1", {
        bookableType: "ROOM",
        bookableId: "room1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(/suspended/i);
  });

  it("rejects a booking on a vehicle whose owner is suspended", async () => {
    prisma.vehicle.findUnique.mockResolvedValue({
      id: "veh1",
      isActive: true,
      capacity: 4,
      pricePerDayMinor: 3000,
      currency: "BDT",
      owner: { verifiedStatus: "VERIFIED", suspendedAt: new Date() },
    });

    await expect(
      service.createBooking("traveler1", {
        bookableType: "VEHICLE",
        bookableId: "veh1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(/suspended/i);
  });

  describe("VEHICLE bookableType", () => {
    it("throws NotFoundException when the vehicle doesn't exist", async () => {
      prisma.vehicle.findUnique.mockResolvedValue(null);
      await expect(
        service.createBooking("u1", {
          bookableType: "VEHICLE",
          bookableId: "missing",
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when the vehicle is inactive", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: false,
        capacity: 4,
        pricePerDayMinor: 300000,
        currency: "BDT",
        ownerId: "v1",
        owner: { verifiedStatus: "VERIFIED" },
      });
      await expect(
        service.createBooking("u1", {
          bookableType: "VEHICLE",
          bookableId: "veh1",
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when guestCount exceeds vehicle capacity", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: true,
        capacity: 3,
        pricePerDayMinor: 300000,
        currency: "BDT",
        ownerId: "v1",
        owner: { verifiedStatus: "VERIFIED" },
      });
      await expect(
        service.createBooking("u1", {
          bookableType: "VEHICLE",
          bookableId: "veh1",
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
          guestCount: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws ForbiddenException when the vehicle owner isn't verified", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: true,
        capacity: 4,
        pricePerDayMinor: 300000,
        currency: "BDT",
        ownerId: "v1",
        owner: { verifiedStatus: "PENDING" },
      });
      await expect(
        service.createBooking("u1", {
          bookableType: "VEHICLE",
          bookableId: "veh1",
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("creates a HELD booking for a verified vehicle owner", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: true,
        capacity: 4,
        pricePerDayMinor: 300000,
        currency: "BDT",
        ownerId: "v1",
        owner: { verifiedStatus: "VERIFIED", suspendedAt: null },
      });
      prisma.$queryRaw.mockResolvedValue([
        makeRawRow({
          bookableType: "VEHICLE",
          roomId: null,
          vehicleId: "veh1",
          totalAmountMinor: 600000,
        }),
      ]);

      const result = await service.createBooking("u1", {
        bookableType: "VEHICLE",
        bookableId: "veh1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
        guestCount: 2,
      });

      expect(result.totalAmountMinor).toBe(600000); // 2 days * 300000
      expect(result.status).toBe("HELD");
    });
  });
});

describe("initiatePayment", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    ledgerEntry: { createMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let expiryQueue: { scheduleExpiry: jest.Mock; cancelExpiry: jest.Mock };
  let paymentProvider: {
    createSession: jest.Mock;
    validateTransaction: jest.Mock;
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      ledgerEntry: { createMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    expiryQueue = { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() };
    paymentProvider = {
      createSession: jest.fn(),
      validateTransaction: jest.fn(),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      expiryQueue as never,
      paymentProvider as never,
      { get: jest.fn() } as never,
    );
  });

  it("creates a payment session for a HELD booking owned by the caller", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "HELD",
      totalAmountMinor: 500000,
      currency: "BDT",
    });
    paymentProvider.createSession.mockResolvedValue({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      tranId: "tran-1",
    });
    prisma.booking.update.mockResolvedValue({});

    const result = await service.initiatePayment("u1", "b1");

    expect(paymentProvider.createSession).toHaveBeenCalledWith(
      "b1",
      500000,
      "BDT",
    );
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { gatewayTranId: "tran-1" },
    });
    expect(result).toEqual({
      gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
    });
  });

  it("throws NotFoundException when the booking does not exist", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    await expect(service.initiatePayment("u1", "missing")).rejects.toThrow(
      "Booking not found",
    );
  });

  it("throws ForbiddenException when the caller does not own the booking", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "someone-else",
      status: "HELD",
    });
    await expect(service.initiatePayment("u1", "b1")).rejects.toThrow(
      "You do not own this booking",
    );
  });

  it("throws ConflictException when the booking is not HELD", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "CONFIRMED",
    });
    await expect(service.initiatePayment("u1", "b1")).rejects.toThrow(/HELD/);
  });
});

describe("confirmIfValid", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    ledgerEntry: { createMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let expiryQueue: { scheduleExpiry: jest.Mock; cancelExpiry: jest.Mock };
  let paymentProvider: {
    createSession: jest.Mock;
    validateTransaction: jest.Mock;
  };
  let service: BookingsService;

  const heldBooking = {
    id: "b1",
    userId: "u1",
    status: "HELD",
    resourceOwnerId: "vendor1",
    totalAmountMinor: 500000,
    currency: "BDT",
  };

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      ledgerEntry: { createMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    expiryQueue = { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() };
    paymentProvider = {
      createSession: jest.fn(),
      validateTransaction: jest.fn(),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      expiryQueue as never,
      paymentProvider as never,
      { get: jest.fn() } as never,
    );
  });

  it("confirms a booking when validation succeeds with matching amount and currency", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ commissionRatePercent: 10 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      ...heldBooking,
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", status: "HELD" },
      data: expect.objectContaining({
        status: "CONFIRMED",
        paymentStatus: "PAID",
        gatewayValId: "val-123",
        vendorOwedMinor: 450000,
      }),
    });
    expect(prisma.ledgerEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          bookingId: "b1",
          type: "GROSS_PAYMENT",
          amountMinor: 500000,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "PLATFORM_FEE",
          amountMinor: 50000,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "VENDOR_OWED",
          amountMinor: 450000,
          ratePercentApplied: 10,
        },
      ],
    });
    expect(expiryQueue.cancelExpiry).toHaveBeenCalledWith("b1");
  });

  it("does nothing when the booking is not found", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    await service.confirmIfValid("missing", "val-123");
    expect(paymentProvider.validateTransaction).not.toHaveBeenCalled();
  });

  it("does nothing when the booking is not HELD (already confirmed by the other path)", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      ...heldBooking,
      status: "CONFIRMED",
    });
    await service.confirmIfValid("b1", "val-123");
    expect(paymentProvider.validateTransaction).not.toHaveBeenCalled();
  });

  it("rejects and makes no state change when validation reports invalid", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the validated amount does not match the booking's total", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 400000,
      currency: "BDT",
      storeId: null,
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the validated currency does not match the booking's currency", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "USD",
      storeId: null,
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when a returned storeId does not match the configured store", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: "some-other-store",
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("is a safe no-op if the guarded update loses the race (count 0)", async () => {
    prisma.booking.findUnique.mockResolvedValue(heldBooking);
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it("computes correct ledger amounts with floor rounding for a non-evenly-divisible total", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      ...heldBooking,
      totalAmountMinor: 999,
    });
    paymentProvider.validateTransaction.mockResolvedValue({
      valid: true,
      amountMinor: 999,
      currency: "BDT",
      storeId: null,
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ commissionRatePercent: 10 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      ...heldBooking,
      status: "CONFIRMED",
    });

    await service.confirmIfValid("b1", "val-123");

    expect(prisma.ledgerEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          bookingId: "b1",
          type: "GROSS_PAYMENT",
          amountMinor: 999,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "PLATFORM_FEE",
          amountMinor: 99,
          ratePercentApplied: 10,
        },
        {
          bookingId: "b1",
          type: "VENDOR_OWED",
          amountMinor: 900,
          ratePercentApplied: 10,
        },
      ],
    });
  });
});

describe("cancel with payment-status policy", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    ledgerEntry: { createMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      ledgerEntry: { createMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  it("cancels a HELD booking with no acknowledgement required", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      status: "CANCELLED",
      paymentStatus: "PENDING",
    });
    const result = await service.cancel("u1", "b1");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", userId: "u1", status: { in: ["HELD", "CONFIRMED"] } },
      data: { status: "CANCELLED" },
    });
    expect(result.status).toBe("CANCELLED");
  });

  it("rejects cancelling a CONFIRMED+PAID booking without acknowledgeNoRefund", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
    await expect(service.cancel("u1", "b1", false)).rejects.toThrow(
      /no refund/i,
    );
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("cancels a CONFIRMED+PAID booking when acknowledgeNoRefund is true, keeping paymentStatus PAID", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      status: "CANCELLED",
      paymentStatus: "PAID",
    });

    const result = await service.cancel("u1", "b1", true);

    expect(result.status).toBe("CANCELLED");
    expect(result.paymentStatus).toBe("PAID");
  });
});

describe("getPaymentStatus", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    ledgerEntry: { createMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      ledgerEntry: { createMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  it("returns the booking's payment status for its own caller", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "u1",
      paymentStatus: "PAID",
      gatewayTranId: "tran-1",
    });
    const result = await service.getPaymentStatus("u1", "b1");
    expect(result).toEqual({ paymentStatus: "PAID", gatewayTranId: "tran-1" });
  });

  it("throws ForbiddenException for a non-owner caller", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      userId: "someone-else",
      paymentStatus: "PENDING",
      gatewayTranId: null,
    });
    await expect(service.getPaymentStatus("u1", "b1")).rejects.toThrow(
      "You do not own this booking",
    );
  });
});

describe("BookingsService.checkout", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  it("completes a CONFIRMED booking owned by the caller", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      userId: "u1",
      bookableType: "ROOM",
      roomId: "r1",
      vehicleId: null,
      resourceOwnerId: "v1",
      guestCount: 2,
      totalAmountMinor: 1000000,
      currency: "BDT",
      status: "COMPLETED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.checkout("v1", "b1");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "b1",
        resourceOwnerId: "v1",
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "COMPLETED" },
    });
    expect(result.status).toBe("COMPLETED");
  });

  it("throws ConflictException when the caller does not own the booking's resource (updateMany matches 0 rows)", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.checkout("someone-else", "b1")).rejects.toThrow(
      ConflictException,
    );
  });
});

describe("BookingsService.cancel", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  it("cancels the caller's own HELD/CONFIRMED booking", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      userId: "u1",
      bookableType: "ROOM",
      roomId: "r1",
      vehicleId: null,
      resourceOwnerId: "v1",
      guestCount: 2,
      totalAmountMinor: 1000000,
      currency: "BDT",
      status: "CANCELLED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.cancel("u1", "b1");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", userId: "u1", status: { in: ["HELD", "CONFIRMED"] } },
      data: { status: "CANCELLED" },
    });
    expect(result.status).toBe("CANCELLED");
  });

  it("throws ConflictException when the booking isn't the caller's or isn't cancellable", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel("u2", "b1")).rejects.toThrow(ConflictException);
  });
});

describe("BookingsService.createBlock", () => {
  let prisma: {
    room: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  it("rejects a block on a room the caller does not own", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "someone-else" },
    });
    await expect(
      service.createBlock("v1", {
        bookableType: "ROOM",
        bookableId: "r1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("creates a BLOCKED row via raw insert for the caller's own room", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "v1" },
    });
    prisma.$queryRaw.mockResolvedValue([{ id: "block-1", status: "BLOCKED" }]);

    await service.createBlock("v1", {
      bookableType: "ROOM",
      bookableId: "r1",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    });

    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("translates an overlap with an existing booking into ConflictException", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "v1" },
    });
    prisma.$queryRaw.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2010",
        clientVersion: "test",
        meta: { code: "23P01" },
      }),
    );
    await expect(
      service.createBlock("v1", {
        bookableType: "ROOM",
        bookableId: "r1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("rethrows a non-exclusion-violation error from the block insert unchanged", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "v1" },
    });
    prisma.$queryRaw.mockRejectedValue(new Error("connection reset"));
    await expect(
      service.createBlock("v1", {
        bookableType: "ROOM",
        bookableId: "r1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      }),
    ).rejects.toThrow("connection reset");
  });

  it("throws when the block insert unexpectedly returns no rows", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "v1" },
    });
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(
      service.createBlock("v1", {
        bookableType: "ROOM",
        bookableId: "r1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      }),
    ).rejects.toThrow("Block insert returned no rows");
  });

  describe("VEHICLE bookableType", () => {
    it("throws NotFoundException when the vehicle doesn't exist", async () => {
      prisma.vehicle.findUnique.mockResolvedValue(null);
      await expect(
        service.createBlock("v1", {
          bookableType: "VEHICLE",
          bookableId: "missing",
          startDate: "2026-09-01",
          endDate: "2026-09-03",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when the vehicle is inactive", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: false,
        ownerId: "v1",
      });
      await expect(
        service.createBlock("v1", {
          bookableType: "VEHICLE",
          bookableId: "veh1",
          startDate: "2026-09-01",
          endDate: "2026-09-03",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects a block on a vehicle the caller does not own", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: true,
        ownerId: "someone-else",
      });
      await expect(
        service.createBlock("v1", {
          bookableType: "VEHICLE",
          bookableId: "veh1",
          startDate: "2026-09-01",
          endDate: "2026-09-03",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("creates a BLOCKED row via raw insert for the caller's own vehicle", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: true,
        ownerId: "v1",
      });
      prisma.$queryRaw.mockResolvedValue([
        { id: "block-1", status: "BLOCKED" },
      ]);

      await service.createBlock("v1", {
        bookableType: "VEHICLE",
        bookableId: "veh1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      });

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});

describe("createOfflineBooking", () => {
  let prisma: {
    $queryRaw: jest.Mock;
    room: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    booking: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    vendorLedgerEntry: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      room: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      booking: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      vendorLedgerEntry: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  const checkIn = futureDateStr(30);
  const checkOut = futureDateStr(32);

  it("inserts a CONFIRMED, source=OFFLINE booking and a linked WALK_IN_BOOKING ledger entry", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "room1",
      hotelId: "hotel1",
      isActive: true,
      hotel: { ownerId: "vendor1" },
    });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([
      {
        id: "booking1",
        userId: null,
        bookableType: "ROOM",
        roomId: "room1",
        vehicleId: null,
        resourceOwnerId: "vendor1",
        checkIn,
        checkOut,
        guestCount: null,
        totalAmountMinor: 5000,
        currency: "BDT",
        status: "CONFIRMED",
        paymentStatus: "PENDING",
        source: "OFFLINE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    prisma.vendorLedgerEntry.create.mockResolvedValue({
      id: "vle1",
      vendorId: "vendor1",
      roomId: "room1",
      vehicleId: null,
      bookingId: "booking1",
      direction: "INCOME",
      category: "WALK_IN_BOOKING",
      amountMinor: 5000,
      note: null,
      entryDate: new Date(checkIn),
      deletedAt: null,
      createdAt: new Date(),
    });

    const result = await service.createOfflineBooking("vendor1", {
      bookableType: "ROOM",
      bookableId: "room1",
      checkIn,
      checkOut,
      amountMinor: 5000,
    });

    expect(result.booking.status).toBe("CONFIRMED");
    expect(result.booking.source).toBe("OFFLINE");
    expect(result.vendorLedgerEntry.category).toBe("WALK_IN_BOOKING");
    expect(prisma.vendorLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "booking1",
          direction: "INCOME",
          category: "WALK_IN_BOOKING",
          amountMinor: 5000,
        }),
      }),
    );
  });

  it("rejects when the caller does not own the room", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "room1",
      hotelId: "hotel1",
      isActive: true,
      hotel: { ownerId: "someone-else" },
    });

    await expect(
      service.createOfflineBooking("vendor1", {
        bookableType: "ROOM",
        bookableId: "room1",
        checkIn,
        checkOut,
        amountMinor: 5000,
      }),
    ).rejects.toThrow(/do not own/i);
  });

  it("translates an exclusion-constraint violation into a 409 Conflict", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "room1",
      hotelId: "hotel1",
      isActive: true,
      hotel: { ownerId: "vendor1" },
    });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    const exclusionError = Object.assign(
      new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2010",
        clientVersion: "6.0.0",
        meta: { code: "23P01" },
      }),
      {},
    );
    prisma.$queryRaw.mockRejectedValue(exclusionError);

    await expect(
      service.createOfflineBooking("vendor1", {
        bookableType: "ROOM",
        bookableId: "room1",
        checkIn,
        checkOut,
        amountMinor: 5000,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe("cancelOfflineBooking", () => {
  let prisma: {
    $queryRaw: jest.Mock;
    room: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    booking: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    vendorLedgerEntry: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      room: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      booking: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      vendorLedgerEntry: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() } as never,
      { createSession: jest.fn(), validateTransaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  it("sets an OFFLINE booking to CANCELLED without touching its linked ledger entry", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking1",
      userId: null,
      bookableType: "ROOM",
      roomId: "room1",
      vehicleId: null,
      resourceOwnerId: "vendor1",
      dateRange: undefined,
      guestCount: null,
      totalAmountMinor: 5000,
      currency: "BDT",
      status: "CANCELLED",
      paymentStatus: "PENDING",
      source: "OFFLINE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.cancelOfflineBooking("vendor1", "booking1");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking1",
        resourceOwnerId: "vendor1",
        source: "OFFLINE",
        status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "CANCELLED" },
    });
    expect(result.status).toBe("CANCELLED");
    expect(prisma.vendorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects when the booking is not found, not owned, or not an OFFLINE booking in a cancellable state", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.cancelOfflineBooking("vendor1", "booking1"),
    ).rejects.toThrow(ConflictException);
  });
});
