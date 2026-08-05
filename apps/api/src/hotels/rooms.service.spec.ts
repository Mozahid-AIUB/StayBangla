import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { HotelsService } from "./hotels.service";
import { RoomsService } from "./rooms.service";

describe("RoomsService", () => {
  let prisma: {
    room: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  };
  let hotelsService: { findByIdOrThrow: jest.Mock };
  let usersService: { findById: jest.Mock };
  let service: RoomsService;

  beforeEach(() => {
    prisma = {
      room: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    };
    hotelsService = { findByIdOrThrow: jest.fn() };
    usersService = {
      findById: jest.fn().mockResolvedValue({ suspendedAt: null }),
    };
    service = new RoomsService(
      prisma as unknown as PrismaService,
      hotelsService as unknown as HotelsService,
      usersService as never,
      {} as never,
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

    it("rejects room creation when the caller is suspended", async () => {
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      usersService.findById.mockResolvedValue({ suspendedAt: new Date() });

      await expect(
        service.create("v1", "h1", {
          roomType: "DOUBLE",
          pricePerNightMinor: 500000,
          capacity: 2,
          hasAC: true,
          bedType: "DOUBLE",
        }),
      ).rejects.toThrow(/suspended/i);
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

    it("rejects a room update when the caller is suspended", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      usersService.findById.mockResolvedValue({ suspendedAt: new Date() });

      await expect(
        service.update("v1", "r1", { pricePerNightMinor: 999999 }),
      ).rejects.toThrow(/suspended/i);
      expect(prisma.room.update).not.toHaveBeenCalled();
    });
  });
});

describe("RoomsService photo methods", () => {
  let prisma: {
    room: { findUnique: jest.Mock };
    roomPhoto: {
      create: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let hotelsService: { findByIdOrThrow: jest.Mock };
  let storagePort: {
    getPresignedUploadUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let service: RoomsService;

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      roomPhoto: {
        create: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    hotelsService = { findByIdOrThrow: jest.fn() };
    storagePort = {
      getPresignedUploadUrl: jest
        .fn()
        .mockResolvedValue("https://minio.local/signed"),
      deleteObject: jest.fn(),
    };
    service = new RoomsService(
      prisma as unknown as PrismaService,
      hotelsService as unknown as HotelsService,
      {} as never,
      storagePort as never,
    );
  });

  describe("presignPhotoUpload", () => {
    it("returns a presigned URL and a server-generated objectKey scoped to the room", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });

      const result = await service.presignPhotoUpload("v1", "r1", "image/jpeg");

      expect(result.objectKey).toMatch(/^rooms\/r1\/.+\.jpg$/);
      expect(result.uploadUrl).toBe("https://minio.local/signed");
      expect(storagePort.getPresignedUploadUrl).toHaveBeenCalledWith(
        result.objectKey,
        "image/jpeg",
      );
    });

    it("rejects when the caller does not own the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.presignPhotoUpload("v1", "r1", "image/jpeg"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when the room doesn't exist", async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(
        service.presignPhotoUpload("v1", "missing", "image/jpeg"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("confirmPhoto", () => {
    it("creates a RoomPhoto row, not primary by default", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.roomPhoto.create.mockResolvedValue({
        id: "p1",
        roomId: "r1",
        isPrimary: false,
      });

      const result = await service.confirmPhoto(
        "v1",
        "r1",
        "rooms/r1/x.jpg",
        false,
      );

      expect(prisma.roomPhoto.create).toHaveBeenCalledWith({
        data: { roomId: "r1", objectKey: "rooms/r1/x.jpg", isPrimary: false },
      });
      expect(result.isPrimary).toBe(false);
    });

    it("clears the existing primary photo before setting a new one when isPrimary=true", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.roomPhoto.create.mockResolvedValue({
        id: "p2",
        roomId: "r1",
        isPrimary: true,
      });

      await service.confirmPhoto("v1", "r1", "rooms/r1/y.jpg", true);

      expect(prisma.roomPhoto.updateMany).toHaveBeenCalledWith({
        where: { roomId: "r1", isPrimary: true },
        data: { isPrimary: false },
      });
      expect(prisma.roomPhoto.create).toHaveBeenCalledWith({
        data: { roomId: "r1", objectKey: "rooms/r1/y.jpg", isPrimary: true },
      });
    });

    it("rejects when the caller does not own the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.confirmPhoto("v1", "r1", "rooms/r1/x.jpg", false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("deletePhoto", () => {
    it("deletes the storage object and the DB row when the caller owns the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.roomPhoto.findUnique.mockResolvedValue({
        id: "p1",
        roomId: "r1",
        objectKey: "rooms/r1/x.jpg",
      });

      await service.deletePhoto("v1", "r1", "p1");

      expect(storagePort.deleteObject).toHaveBeenCalledWith("rooms/r1/x.jpg");
      expect(prisma.roomPhoto.delete).toHaveBeenCalledWith({
        where: { id: "p1" },
      });
    });

    it("throws NotFoundException when the photo doesn't exist", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.roomPhoto.findUnique.mockResolvedValue(null);
      await expect(service.deletePhoto("v1", "r1", "missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects when the caller does not own the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(service.deletePhoto("v1", "r1", "p1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("rejects deleting a photo that belongs to a different room (cross-room IDOR)", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.roomPhoto.findUnique.mockResolvedValue({
        id: "p1",
        roomId: "r2-someone-elses-room",
        objectKey: "rooms/r2-someone-elses-room/x.jpg",
      });
      await expect(service.deletePhoto("v1", "r1", "p1")).rejects.toThrow(
        NotFoundException,
      );
      expect(storagePort.deleteObject).not.toHaveBeenCalled();
      expect(prisma.roomPhoto.delete).not.toHaveBeenCalled();
    });
  });
});
