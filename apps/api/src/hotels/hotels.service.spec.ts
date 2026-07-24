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
      {} as never,
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
        city: "DHAKA",
        address: "123 Rd",
        checkInTime: "14:00",
        checkOutTime: "12:00",
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
          city: "DHAKA",
          address: "123 Rd",
          checkInTime: "14:00",
          checkOutTime: "12:00",
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.hotel.create).not.toHaveBeenCalled();
    });

    it("rejects when the owner does not exist", async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(
        service.create("nope", {
          name: "Test Hotel",
          city: "DHAKA",
          address: "123 Rd",
          checkInTime: "14:00",
          checkOutTime: "12:00",
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
        "DHAKA",
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

describe("HotelsService photo methods", () => {
  let prisma: {
    hotel: { findUnique: jest.Mock };
    hotelPhoto: {
      create: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let storagePort: {
    getPresignedUploadUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let service: HotelsService;

  beforeEach(() => {
    prisma = {
      hotel: { findUnique: jest.fn() },
      hotelPhoto: {
        create: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    storagePort = {
      getPresignedUploadUrl: jest
        .fn()
        .mockResolvedValue("https://minio.local/signed"),
      deleteObject: jest.fn(),
    };
    service = new HotelsService(
      prisma as unknown as PrismaService,
      {} as never,
      storagePort as never,
    );
  });

  describe("presignPhotoUpload", () => {
    it("returns a presigned URL and a server-generated objectKey scoped to the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });

      const result = await service.presignPhotoUpload("v1", "h1", "image/jpeg");

      expect(result.objectKey).toMatch(/^hotels\/h1\/.+\.jpg$/);
      expect(result.uploadUrl).toBe("https://minio.local/signed");
      expect(storagePort.getPresignedUploadUrl).toHaveBeenCalledWith(
        result.objectKey,
        "image/jpeg",
      );
    });

    it("rejects when the caller does not own the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.presignPhotoUpload("v1", "h1", "image/jpeg"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("confirmPhoto", () => {
    it("creates a HotelPhoto row, not primary by default", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.create.mockResolvedValue({
        id: "p1",
        hotelId: "h1",
        isPrimary: false,
      });

      const result = await service.confirmPhoto(
        "v1",
        "h1",
        "hotels/h1/x.jpg",
        false,
      );

      expect(prisma.hotelPhoto.create).toHaveBeenCalledWith({
        data: { hotelId: "h1", objectKey: "hotels/h1/x.jpg", isPrimary: false },
      });
      expect(result.isPrimary).toBe(false);
    });

    it("clears the existing primary photo before setting a new one when isPrimary=true", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.create.mockResolvedValue({
        id: "p2",
        hotelId: "h1",
        isPrimary: true,
      });

      await service.confirmPhoto("v1", "h1", "hotels/h1/y.jpg", true);

      expect(prisma.hotelPhoto.updateMany).toHaveBeenCalledWith({
        where: { hotelId: "h1", isPrimary: true },
        data: { isPrimary: false },
      });
      expect(prisma.hotelPhoto.create).toHaveBeenCalledWith({
        data: { hotelId: "h1", objectKey: "hotels/h1/y.jpg", isPrimary: true },
      });
    });

    it("rejects when the caller does not own the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.confirmPhoto("v1", "h1", "hotels/h1/x.jpg", false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("deletePhoto", () => {
    it("deletes the storage object and the DB row when the caller owns the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.findUnique.mockResolvedValue({
        id: "p1",
        hotelId: "h1",
        objectKey: "hotels/h1/x.jpg",
      });

      await service.deletePhoto("v1", "h1", "p1");

      expect(storagePort.deleteObject).toHaveBeenCalledWith("hotels/h1/x.jpg");
      expect(prisma.hotelPhoto.delete).toHaveBeenCalledWith({
        where: { id: "p1" },
      });
    });

    it("throws NotFoundException when the photo doesn't exist", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.findUnique.mockResolvedValue(null);
      await expect(service.deletePhoto("v1", "h1", "missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects when the caller does not own the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(service.deletePhoto("v1", "h1", "p1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("rejects deleting a photo that belongs to a different hotel (cross-hotel IDOR)", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.findUnique.mockResolvedValue({
        id: "p1",
        hotelId: "h2-someone-elses-hotel",
        objectKey: "hotels/h2-someone-elses-hotel/x.jpg",
      });
      await expect(service.deletePhoto("v1", "h1", "p1")).rejects.toThrow(
        NotFoundException,
      );
      expect(storagePort.deleteObject).not.toHaveBeenCalled();
      expect(prisma.hotelPhoto.delete).not.toHaveBeenCalled();
    });
  });
});
