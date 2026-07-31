import { Test } from "@nestjs/testing";
import { AdminOverviewController } from "./admin-overview.controller";
import { AdminOverviewService } from "./admin-overview.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminOverviewController", () => {
  let controller: AdminOverviewController;
  let service: { getOverview: jest.Mock };

  beforeEach(async () => {
    service = { getOverview: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminOverviewController],
      providers: [{ provide: AdminOverviewService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminOverviewController);
  });

  it("delegates to AdminOverviewService.getOverview", async () => {
    service.getOverview.mockResolvedValue({ totalVendors: 1 });

    const result = await controller.getOverview();

    expect(service.getOverview).toHaveBeenCalled();
    expect(result).toEqual({ totalVendors: 1 });
  });
});
