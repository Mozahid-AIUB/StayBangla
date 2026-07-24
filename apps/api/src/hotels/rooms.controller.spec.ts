import { Test } from "@nestjs/testing";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";
import { HotelsService } from "./hotels.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("RoomsController", () => {
  let controller: RoomsController;
  let roomsService: {
    create: jest.Mock;
    update: jest.Mock;
    presignPhotoUpload: jest.Mock;
    confirmPhoto: jest.Mock;
    deletePhoto: jest.Mock;
  };
  let hotelsService: { searchAvailableRooms: jest.Mock };

  beforeEach(async () => {
    roomsService = {
      create: jest.fn(),
      update: jest.fn(),
      presignPhotoUpload: jest.fn(),
      confirmPhoto: jest.fn(),
      deletePhoto: jest.fn(),
    };
    hotelsService = { searchAvailableRooms: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        { provide: RoomsService, useValue: roomsService },
        { provide: HotelsService, useValue: hotelsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(RoomsController);
  });

  it("available() delegates to HotelsService.searchAvailableRooms", async () => {
    hotelsService.searchAvailableRooms.mockResolvedValue([{ id: "r1" }]);
    const result = await controller.available({
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
      city: "DHAKA",
    });
    expect(hotelsService.searchAvailableRooms).toHaveBeenCalledWith(
      "2026-09-01",
      "2026-09-03",
      "DHAKA",
    );
    expect(result).toEqual([{ id: "r1" }]);
  });

  it("create() delegates to RoomsService.create with the caller's id and hotel id", async () => {
    roomsService.create.mockResolvedValue({ id: "r1" });
    const result = await controller.create(
      { id: "v1", roles: ["VENDOR"] },
      "h1",
      {
        roomType: "DOUBLE",
        pricePerNightMinor: 500000,
        capacity: 2,
        hasAC: true,
        bedType: "DOUBLE",
      },
    );
    expect(roomsService.create).toHaveBeenCalledWith("v1", "h1", {
      roomType: "DOUBLE",
      pricePerNightMinor: 500000,
      capacity: 2,
      hasAC: true,
      bedType: "DOUBLE",
    });
    expect(result).toEqual({ id: "r1" });
  });

  it("update() delegates to RoomsService.update with the caller's id and room id", async () => {
    roomsService.update.mockResolvedValue({ id: "r1", isActive: false });
    const result = await controller.update(
      { id: "v1", roles: ["VENDOR"] },
      "r1",
      { isActive: false },
    );
    expect(roomsService.update).toHaveBeenCalledWith("v1", "r1", {
      isActive: false,
    });
    expect(result).toEqual({ id: "r1", isActive: false });
  });

  describe("photo endpoints", () => {
    it("presignPhoto() delegates with the caller's id", async () => {
      roomsService.presignPhotoUpload.mockResolvedValue({
        uploadUrl: "https://x",
        objectKey: "rooms/r1/y.jpg",
      });
      const result = await controller.presignPhoto(
        { id: "v1", roles: ["VENDOR"] },
        "r1",
        { contentType: "image/jpeg" },
      );
      expect(roomsService.presignPhotoUpload).toHaveBeenCalledWith(
        "v1",
        "r1",
        "image/jpeg",
      );
      expect(result.objectKey).toBe("rooms/r1/y.jpg");
    });

    it("confirmPhoto() delegates with the caller's id", async () => {
      roomsService.confirmPhoto.mockResolvedValue({
        id: "p1",
        isPrimary: true,
      });
      await controller.confirmPhoto({ id: "v1", roles: ["VENDOR"] }, "r1", {
        objectKey: "rooms/r1/y.jpg",
        isPrimary: true,
      });
      expect(roomsService.confirmPhoto).toHaveBeenCalledWith(
        "v1",
        "r1",
        "rooms/r1/y.jpg",
        true,
      );
    });

    it("deletePhoto() delegates with the caller's id", async () => {
      await controller.deletePhoto({ id: "v1", roles: ["VENDOR"] }, "r1", "p1");
      expect(roomsService.deletePhoto).toHaveBeenCalledWith("v1", "r1", "p1");
    });
  });
});
