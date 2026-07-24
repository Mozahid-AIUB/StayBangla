import { Test } from "@nestjs/testing";
import { HotelsController } from "./hotels.controller";
import { HotelsService } from "./hotels.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("HotelsController", () => {
  let controller: HotelsController;
  let hotelsService: {
    create: jest.Mock;
    presignPhotoUpload: jest.Mock;
    confirmPhoto: jest.Mock;
    deletePhoto: jest.Mock;
    findPublicDetailOrThrow: jest.Mock;
  };

  beforeEach(async () => {
    hotelsService = {
      create: jest.fn(),
      presignPhotoUpload: jest.fn(),
      confirmPhoto: jest.fn(),
      deletePhoto: jest.fn(),
      findPublicDetailOrThrow: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HotelsController],
      providers: [{ provide: HotelsService, useValue: hotelsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(HotelsController);
  });

  it("create() delegates to HotelsService.create with the current user's id", async () => {
    hotelsService.create.mockResolvedValue({ id: "h1" });
    const result = await controller.create(
      { id: "v1", roles: ["VENDOR"] },
      {
        name: "Test Hotel",
        city: "DHAKA",
        address: "123 Rd",
        checkInTime: "14:00",
        checkOutTime: "12:00",
      },
    );
    expect(hotelsService.create).toHaveBeenCalledWith("v1", {
      name: "Test Hotel",
      city: "DHAKA",
      address: "123 Rd",
      checkInTime: "14:00",
      checkOutTime: "12:00",
    });
    expect(result).toEqual({ id: "h1" });
  });

  it("findOne() delegates to HotelsService.findPublicDetailOrThrow", async () => {
    hotelsService.findPublicDetailOrThrow.mockResolvedValue({
      id: "h1",
      rooms: [],
      photos: [],
    });
    const result = await controller.findOne("h1");
    expect(hotelsService.findPublicDetailOrThrow).toHaveBeenCalledWith("h1");
    expect(result).toEqual({ id: "h1", rooms: [], photos: [] });
  });

  describe("photo endpoints", () => {
    it("presignPhoto() delegates with the caller's id", async () => {
      hotelsService.presignPhotoUpload.mockResolvedValue({
        uploadUrl: "https://x",
        objectKey: "hotels/h1/y.jpg",
      });
      const result = await controller.presignPhoto(
        { id: "v1", roles: ["VENDOR"] },
        "h1",
        { contentType: "image/jpeg" },
      );
      expect(hotelsService.presignPhotoUpload).toHaveBeenCalledWith(
        "v1",
        "h1",
        "image/jpeg",
      );
      expect(result.objectKey).toBe("hotels/h1/y.jpg");
    });

    it("confirmPhoto() delegates with the caller's id", async () => {
      hotelsService.confirmPhoto.mockResolvedValue({
        id: "p1",
        isPrimary: true,
      });
      await controller.confirmPhoto({ id: "v1", roles: ["VENDOR"] }, "h1", {
        objectKey: "hotels/h1/y.jpg",
        isPrimary: true,
      });
      expect(hotelsService.confirmPhoto).toHaveBeenCalledWith(
        "v1",
        "h1",
        "hotels/h1/y.jpg",
        true,
      );
    });

    it("deletePhoto() delegates with the caller's id", async () => {
      await controller.deletePhoto({ id: "v1", roles: ["VENDOR"] }, "h1", "p1");
      expect(hotelsService.deletePhoto).toHaveBeenCalledWith("v1", "h1", "p1");
    });
  });
});
