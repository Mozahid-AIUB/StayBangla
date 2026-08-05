import { Test } from "@nestjs/testing";
import { VendorSuspensionController } from "./vendor-suspension.controller";
import { VendorSuspensionService } from "./vendor-suspension.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VendorSuspensionController", () => {
  let controller: VendorSuspensionController;
  let service: { suspend: jest.Mock; unsuspend: jest.Mock };

  beforeEach(async () => {
    service = { suspend: jest.fn(), unsuspend: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [VendorSuspensionController],
      providers: [{ provide: VendorSuspensionService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VendorSuspensionController);
  });

  it("suspend() delegates to VendorSuspensionService.suspend with the caller's id, target id, and reason", async () => {
    service.suspend.mockResolvedValue({
      id: "vendor1",
      passwordHash: "secret",
    });

    const result = await controller.suspend(
      { id: "admin1", roles: ["ADMIN"] },
      "vendor1",
      { reason: "fraud" },
    );

    expect(service.suspend).toHaveBeenCalledWith("admin1", "vendor1", "fraud");
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("unsuspend() delegates to VendorSuspensionService.unsuspend", async () => {
    service.unsuspend.mockResolvedValue({
      id: "vendor1",
      passwordHash: "secret",
    });

    const result = await controller.unsuspend(
      { id: "admin1", roles: ["ADMIN"] },
      "vendor1",
    );

    expect(service.unsuspend).toHaveBeenCalledWith("admin1", "vendor1");
    expect(result).not.toHaveProperty("passwordHash");
  });
});
