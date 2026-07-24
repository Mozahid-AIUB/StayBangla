import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { VehiclesService } from "./vehicles.service";

describe("VehiclesService", () => {
  let prisma: {
    vehicle: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let usersService: { findById: jest.Mock };
  let service: VehiclesService;

  beforeEach(() => {
    prisma = {
      vehicle: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    usersService = { findById: jest.fn() };
    service = new VehiclesService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    );
  });

  describe("create", () => {
    it("creates a vehicle when the owner is VERIFIED", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });
      prisma.vehicle.create.mockResolvedValue({ id: "veh1", ownerId: "v1" });

      const result = await service.create("v1", {
        category: "CNG",
        city: "DHAKA",
        capacity: 3,
        pricePerDayMinor: 200000,
      });

      expect(prisma.vehicle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: "v1", category: "CNG" }),
        }),
      );
      expect(result.id).toBe("veh1");
    });

    it("rejects an unverified owner", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });
      await expect(
        service.create("v1", {
          category: "CNG",
          city: "DHAKA",
          capacity: 3,
          pricePerDayMinor: 200000,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("update", () => {
    it("updates when the caller owns the vehicle", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        ownerId: "v1",
      });
      prisma.vehicle.update.mockResolvedValue({ id: "veh1", isActive: false });
      const result = await service.update("v1", "veh1", { isActive: false });
      expect(result.isActive).toBe(false);
    });

    it("rejects when the caller does not own the vehicle", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        ownerId: "someone-else",
      });
      await expect(
        service.update("v1", "veh1", { isActive: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException for a missing vehicle", async () => {
      prisma.vehicle.findUnique.mockResolvedValue(null);
      await expect(
        service.update("v1", "missing", { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("findByIdOrThrow", () => {
    it("returns the vehicle when it exists and is active", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: true,
      });
      const result = await service.findByIdOrThrow("veh1");
      expect(result).toEqual({ id: "veh1", isActive: true });
    });

    it("throws NotFoundException when the vehicle does not exist", async () => {
      prisma.vehicle.findUnique.mockResolvedValue(null);
      await expect(service.findByIdOrThrow("missing")).rejects.toThrow(
        "Vehicle not found",
      );
    });

    it("throws NotFoundException when the vehicle is soft-deleted (isActive: false)", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        isActive: false,
      });
      await expect(service.findByIdOrThrow("veh1")).rejects.toThrow(
        "Vehicle not found",
      );
    });
  });

  describe("searchAvailable", () => {
    it("delegates to a raw query for the given date and city", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: "veh1", category: "CNG", city: "DHAKA" },
      ]);
      const results = await service.searchAvailable(
        "2026-09-01",
        "2026-09-02",
        "DHAKA",
      );
      expect(results).toHaveLength(1);
    });

    it("delegates to a raw query without a city filter when city is omitted", async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const results = await service.searchAvailable("2026-09-01", "2026-09-02");
      expect(results).toEqual([]);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});
