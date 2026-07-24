import { Test } from "@nestjs/testing";
import { VehiclesController } from "./vehicles.controller";
import { VehiclesService } from "./vehicles.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VehiclesController", () => {
  let controller: VehiclesController;
  let vehiclesService: {
    create: jest.Mock;
    update: jest.Mock;
    searchAvailable: jest.Mock;
  };

  beforeEach(async () => {
    vehiclesService = {
      create: jest.fn(),
      update: jest.fn(),
      searchAvailable: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VehiclesController],
      providers: [{ provide: VehiclesService, useValue: vehiclesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VehiclesController);
  });

  it("available() delegates to VehiclesService.searchAvailable", async () => {
    vehiclesService.searchAvailable.mockResolvedValue([{ id: "veh1" }]);
    const result = await controller.available(
      "2026-09-01",
      "2026-09-02",
      "Dhaka",
    );
    expect(vehiclesService.searchAvailable).toHaveBeenCalledWith(
      "2026-09-01",
      "2026-09-02",
      "Dhaka",
    );
    expect(result).toEqual([{ id: "veh1" }]);
  });

  it("create() delegates with the caller's id", async () => {
    vehiclesService.create.mockResolvedValue({ id: "veh1" });
    const result = await controller.create(
      { id: "v1", roles: ["VENDOR"] },
      { category: "CNG", city: "Dhaka", capacity: 3, pricePerDayMinor: 200000 },
    );
    expect(vehiclesService.create).toHaveBeenCalledWith("v1", {
      category: "CNG",
      city: "Dhaka",
      capacity: 3,
      pricePerDayMinor: 200000,
    });
    expect(result).toEqual({ id: "veh1" });
  });
});
