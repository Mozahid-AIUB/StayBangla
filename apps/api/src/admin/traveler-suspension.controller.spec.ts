import { Test } from "@nestjs/testing";
import { TravelerSuspensionController } from "./traveler-suspension.controller";
import { VendorSuspensionService } from "./vendor-suspension.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("TravelerSuspensionController", () => {
  let controller: TravelerSuspensionController;
  let service: { suspend: jest.Mock; unsuspend: jest.Mock };

  beforeEach(async () => {
    service = { suspend: jest.fn(), unsuspend: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [TravelerSuspensionController],
      providers: [{ provide: VendorSuspensionService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(TravelerSuspensionController);
  });

  it("suspend() delegates to the shared VendorSuspensionService.suspend with the traveler's id and the TRAVELER_SUSPENDED action label", async () => {
    service.suspend.mockResolvedValue({
      id: "traveler1",
      passwordHash: "secret",
    });

    const result = await controller.suspend(
      { id: "admin1", roles: ["ADMIN"] },
      "traveler1",
      { reason: "abusive behavior toward vendors" },
    );

    expect(service.suspend).toHaveBeenCalledWith(
      "admin1",
      "traveler1",
      "abusive behavior toward vendors",
      "TRAVELER_SUSPENDED",
    );
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("unsuspend() delegates to the shared VendorSuspensionService.unsuspend with the TRAVELER_UNSUSPENDED action label", async () => {
    service.unsuspend.mockResolvedValue({
      id: "traveler1",
      passwordHash: "secret",
    });

    const result = await controller.unsuspend(
      { id: "admin1", roles: ["ADMIN"] },
      "traveler1",
    );

    expect(service.unsuspend).toHaveBeenCalledWith(
      "admin1",
      "traveler1",
      "TRAVELER_UNSUSPENDED",
    );
    expect(result).not.toHaveProperty("passwordHash");
  });
});
