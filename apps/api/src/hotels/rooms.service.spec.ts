import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { HotelsService } from "./hotels.service";
import { RoomsService } from "./rooms.service";

describe("RoomsService", () => {
  let prisma: {
    room: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  };
  let hotelsService: { findByIdOrThrow: jest.Mock };
  let service: RoomsService;

  beforeEach(() => {
    prisma = {
      room: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    };
    hotelsService = { findByIdOrThrow: jest.fn() };
    service = new RoomsService(
      prisma as unknown as PrismaService,
      hotelsService as unknown as HotelsService,
    );
  });

  describe("create", () => {
    it("creates a room when the caller owns the hotel", async () => {
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.room.create.mockResolvedValue({ id: "r1", hotelId: "h1" });

      const result = await service.create("v1", "h1", {
        roomType: "DOUBLE",
        pricePerNightMinor: 500000,
        capacity: 2,
        hasAC: true,
        bedType: "DOUBLE",
      });

      expect(prisma.room.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hotelId: "h1", roomType: "DOUBLE" }),
        }),
      );
      expect(result.id).toBe("r1");
    });

    it("rejects when the caller does not own the hotel", async () => {
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.create("v1", "h1", {
          roomType: "DOUBLE",
          pricePerNightMinor: 500000,
          capacity: 2,
          hasAC: true,
          bedType: "DOUBLE",
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.room.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("updates a room when the caller owns the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.room.update.mockResolvedValue({ id: "r1", isActive: false });

      const result = await service.update("v1", "r1", { isActive: false });

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it("rejects when the caller does not own the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.update("v1", "r1", { isActive: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when the room doesn't exist", async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(
        service.update("v1", "missing", { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
