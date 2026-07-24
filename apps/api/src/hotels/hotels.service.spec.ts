import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { HotelsService } from "./hotels.service";

describe("HotelsService", () => {
  let prisma: { hotel: { create: jest.Mock; findUnique: jest.Mock } };
  let usersService: { findById: jest.Mock };
  let service: HotelsService;

  beforeEach(() => {
    prisma = { hotel: { create: jest.fn(), findUnique: jest.fn() } };
    usersService = { findById: jest.fn() };
    service = new HotelsService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    );
  });

  describe("create", () => {
    it("creates a hotel when the owner is a VERIFIED vendor", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });
      prisma.hotel.create.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
        name: "Test Hotel",
      });

      const result = await service.create("v1", {
        name: "Test Hotel",
        city: "Dhaka",
        address: "123 Rd",
      });

      expect(prisma.hotel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: "v1", name: "Test Hotel" }),
        }),
      );
      expect(result.id).toBe("h1");
    });

    it("rejects when the owner is PENDING (not yet verified)", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });
      await expect(
        service.create("v1", {
          name: "Test Hotel",
          city: "Dhaka",
          address: "123 Rd",
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.hotel.create).not.toHaveBeenCalled();
    });

    it("rejects when the owner does not exist", async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(
        service.create("nope", {
          name: "Test Hotel",
          city: "Dhaka",
          address: "123 Rd",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("findByIdOrThrow", () => {
    it("returns the hotel when found", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1" });
      await expect(service.findByIdOrThrow("h1")).resolves.toEqual({
        id: "h1",
      });
    });

    it("throws NotFoundException when missing", async () => {
      prisma.hotel.findUnique.mockResolvedValue(null);
      await expect(service.findByIdOrThrow("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("searchAvailableRooms", () => {
    it("delegates to a raw query with the given date range and optional city", async () => {
      (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([
          {
            id: "r1",
            hotelId: "h1",
            roomType: "DOUBLE",
            pricePerNightMinor: 500000,
            currency: "BDT",
            capacity: 2,
          },
        ]);
      const results = await service.searchAvailableRooms(
        "2026-09-01",
        "2026-09-03",
        "Dhaka",
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.roomType).toBe("DOUBLE");
    });

    it("delegates to a raw query without a city filter when city is omitted", async () => {
      (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([]);
      const results = await service.searchAvailableRooms(
        "2026-09-01",
        "2026-09-03",
      );
      expect(results).toEqual([]);
      expect(
        (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw,
      ).toHaveBeenCalled();
    });
  });
});
