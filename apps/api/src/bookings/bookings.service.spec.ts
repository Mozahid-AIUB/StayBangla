import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BookingsService } from "./bookings.service";

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
      { charge: jest.fn() } as never,
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
      hotel: { ownerId: "v1", owner: { verifiedStatus: "VERIFIED" } },
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
      hotel: { ownerId: "v1", owner: { verifiedStatus: "VERIFIED" } },
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
});

describe("BookingsService.confirmPayment", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let expiryQueue: { scheduleExpiry: jest.Mock; cancelExpiry: jest.Mock };
  let paymentProvider: { charge: jest.Mock };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    expiryQueue = { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() };
    paymentProvider = {
      charge: jest.fn().mockResolvedValue({ success: true }),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      expiryQueue as never,
      paymentProvider as never,
    );
  });

  it("confirms a HELD booking, charges via the payment provider, and cancels the expiry job", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "HELD",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });
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
      status: "CONFIRMED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.confirmPayment("b1");

    expect(paymentProvider.charge).toHaveBeenCalledWith("b1", 1000000, "BDT");
    expect(expiryQueue.cancelExpiry).toHaveBeenCalledWith("b1");
    expect(result.status).toBe("CONFIRMED");
  });

  it("is idempotent: calling confirmPayment on an already-CONFIRMED booking succeeds without re-charging", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "CONFIRMED",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });

    const result = await service.confirmPayment("b1");

    expect(paymentProvider.charge).not.toHaveBeenCalled();
    expect(result.status).toBe("CONFIRMED");
  });

  it("throws ConflictException when the booking already expired (AUTO_CANCELLED)", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "AUTO_CANCELLED",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });
    await expect(service.confirmPayment("b1")).rejects.toThrow(
      ConflictException,
    );
  });

  it("throws ConflictException when the auto-cancel timer wins the race after the read", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "HELD",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.confirmPayment("b1")).rejects.toThrow(
      ConflictException,
    );
    expect(paymentProvider.charge).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for a missing booking", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    await expect(service.confirmPayment("missing")).rejects.toThrow(
      NotFoundException,
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
      { charge: jest.fn() } as never,
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
      { charge: jest.fn() } as never,
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
      { charge: jest.fn() } as never,
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
});
