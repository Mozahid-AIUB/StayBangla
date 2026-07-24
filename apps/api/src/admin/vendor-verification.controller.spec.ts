import { Test } from "@nestjs/testing";
import { VendorVerificationController } from "./vendor-verification.controller";
import { VendorVerificationService } from "./vendor-verification.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VendorVerificationController", () => {
  let controller: VendorVerificationController;
  let service: {
    listPending: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    getHistory: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listPending: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      getHistory: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VendorVerificationController],
      providers: [{ provide: VendorVerificationService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VendorVerificationController);
  });

  it("listPending() delegates to the service", async () => {
    service.listPending.mockResolvedValue([{ id: "v1" }]);
    const result = await controller.listPending();
    expect(result).toEqual([{ id: "v1" }]);
  });

  it("approve() passes the admin's id and vendor id", async () => {
    service.approve.mockResolvedValue({ id: "v1", verifiedStatus: "VERIFIED" });
    await controller.approve({ id: "admin1", roles: ["ADMIN"] }, "v1");
    expect(service.approve).toHaveBeenCalledWith("admin1", "v1");
  });

  it("reject() passes the admin's id, vendor id, and reason", async () => {
    service.reject.mockResolvedValue({ id: "v1", verifiedStatus: "REJECTED" });
    await controller.reject({ id: "admin1", roles: ["ADMIN"] }, "v1", {
      reason: "bad docs",
    });
    expect(service.reject).toHaveBeenCalledWith("admin1", "v1", "bad docs");
  });

  it("getHistory() passes the vendor id", async () => {
    service.getHistory.mockResolvedValue([{ id: "log1" }]);
    await controller.getHistory("v1");
    expect(service.getHistory).toHaveBeenCalledWith("v1");
  });
});
