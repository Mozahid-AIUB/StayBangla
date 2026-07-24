import { Test } from "@nestjs/testing";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";
import { HotelsService } from "./hotels.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("RoomsController", () => {
  let controller: RoomsController;
  let roomsService: { create: jest.Mock; update: jest.Mock };
  let hotelsService: { searchAvailableRooms: jest.Mock };

  beforeEach(async () => {
    roomsService = { create: jest.fn(), update: jest.fn() };
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
    const result = await controller.available(
      "2026-09-01",
      "2026-09-03",
      "Dhaka",
    );
    expect(hotelsService.searchAvailableRooms).toHaveBeenCalledWith(
      "2026-09-01",
      "2026-09-03",
      "Dhaka",
    );
    expect(result).toEqual([{ id: "r1" }]);
  });

  it("create() delegates to RoomsService.create with the caller's id and hotel id", async () => {
    roomsService.create.mockResolvedValue({ id: "r1" });
    const result = await controller.create(
      { id: "v1", roles: ["VENDOR"] },
      "h1",
      { roomType: "DOUBLE", pricePerNightMinor: 500000, capacity: 2 },
    );
    expect(roomsService.create).toHaveBeenCalledWith("v1", "h1", {
      roomType: "DOUBLE",
      pricePerNightMinor: 500000,
      capacity: 2,
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
});
