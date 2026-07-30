import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorLedgerService } from "./vendor-ledger.service";

describe("VendorLedgerService", () => {
  let service: VendorLedgerService;
  let prisma: {
    room: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    vendorLedgerEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      vendorLedgerEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new VendorLedgerService(prisma as unknown as PrismaService);
  });

  describe("create", () => {
    it("creates an entry for a room the caller owns", async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: "room1",
        hotel: { ownerId: "vendor1" },
      });
      prisma.vendorLedgerEntry.create.mockResolvedValue({ id: "vle1" });

      await service.create("vendor1", {
        roomId: "room1",
        direction: "EXPENSE",
        category: "MAINTENANCE",
        amountMinor: 2000,
        entryDate: "2026-08-01",
      });

      expect(prisma.vendorLedgerEntry.create).toHaveBeenCalledWith({
        data: {
          vendorId: "vendor1",
          roomId: "room1",
          vehicleId: undefined,
          bookingId: null,
          direction: "EXPENSE",
          category: "MAINTENANCE",
          amountMinor: 2000,
          note: undefined,
          entryDate: new Date("2026-08-01"),
        },
      });
    });

    it("creates an entry for a vehicle the caller owns", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        ownerId: "vendor1",
      });
      prisma.vendorLedgerEntry.create.mockResolvedValue({ id: "vle2" });

      await service.create("vendor1", {
        vehicleId: "veh1",
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 3000,
        entryDate: "2026-08-01",
      });

      expect(prisma.vendorLedgerEntry.create).toHaveBeenCalled();
    });

    it("rejects category=WALK_IN_BOOKING", async () => {
      await expect(
        service.create("vendor1", {
          roomId: "room1",
          direction: "INCOME",
          category: "WALK_IN_BOOKING" as never,
          amountMinor: 5000,
          entryDate: "2026-08-01",
        }),
      ).rejects.toThrow(/POST \/vendor\/bookings\/offline/);
    });

    it("rejects when neither roomId nor vehicleId is given", async () => {
      await expect(
        service.create("vendor1", {
          direction: "INCOME",
          category: "OTHER",
          amountMinor: 5000,
          entryDate: "2026-08-01",
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when both roomId and vehicleId are given", async () => {
      await expect(
        service.create("vendor1", {
          roomId: "room1",
          vehicleId: "veh1",
          direction: "INCOME",
          category: "OTHER",
          amountMinor: 5000,
          entryDate: "2026-08-01",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when the caller does not own the referenced room", async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: "room1",
        hotel: { ownerId: "someone-else" },
      });

      await expect(
        service.create("vendor1", {
          roomId: "room1",
          direction: "INCOME",
          category: "OTHER",
          amountMinor: 5000,
          entryDate: "2026-08-01",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("list", () => {
    it("returns only the caller's own non-deleted entries, newest first", async () => {
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([{ id: "vle1" }]);

      const result = await service.list("vendor1");

      expect(prisma.vendorLedgerEntry.findMany).toHaveBeenCalledWith({
        where: { vendorId: "vendor1", deletedAt: null },
        orderBy: { entryDate: "desc" },
      });
      expect(result).toEqual([{ id: "vle1" }]);
    });
  });

  describe("softDelete", () => {
    it("sets deletedAt on the caller's own entry", async () => {
      prisma.vendorLedgerEntry.findUnique.mockResolvedValue({
        id: "vle1",
        vendorId: "vendor1",
      });

      await service.softDelete("vendor1", "vle1");

      expect(prisma.vendorLedgerEntry.update).toHaveBeenCalledWith({
        where: { id: "vle1" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("rejects deleting another vendor's entry", async () => {
      prisma.vendorLedgerEntry.findUnique.mockResolvedValue({
        id: "vle1",
        vendorId: "someone-else",
      });

      await expect(service.softDelete("vendor1", "vle1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
