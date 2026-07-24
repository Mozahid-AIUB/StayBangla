import { Test } from "@nestjs/testing";
import { HotelsController } from "./hotels.controller";
import { HotelsService } from "./hotels.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("HotelsController", () => {
  let controller: HotelsController;
  let hotelsService: { create: jest.Mock };

  beforeEach(async () => {
    hotelsService = { create: jest.fn() };
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
      { name: "Test Hotel", city: "Dhaka", address: "123 Rd" },
    );
    expect(hotelsService.create).toHaveBeenCalledWith("v1", {
      name: "Test Hotel",
      city: "Dhaka",
      address: "123 Rd",
    });
    expect(result).toEqual({ id: "h1" });
  });
});
