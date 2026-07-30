import { Test } from "@nestjs/testing";
import { AdminAuditLogController } from "./admin-audit-log.controller";
import { AdminAuditLogService } from "./admin-audit-log.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminAuditLogController", () => {
  let controller: AdminAuditLogController;
  let service: { list: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuditLogController],
      providers: [{ provide: AdminAuditLogService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminAuditLogController);
  });

  it("delegates to AdminAuditLogService.list with the query params", async () => {
    service.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });

    await controller.list({
      vendorId: "vendor1",
      adminId: "admin1",
      page: 2,
      pageSize: 10,
    });

    expect(service.list).toHaveBeenCalledWith({
      vendorId: "vendor1",
      adminId: "admin1",
      page: 2,
      pageSize: 10,
    });
  });
});
