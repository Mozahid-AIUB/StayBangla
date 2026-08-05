import { PrismaService } from "../prisma/prisma.service";
import { AdminAuditLogService } from "./admin-audit-log.service";

describe("AdminAuditLogService", () => {
  let service: AdminAuditLogService;
  let prisma: {
    adminAuditLog: { findMany: jest.Mock; count: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      adminAuditLog: { findMany: jest.fn(), count: jest.fn() },
    };
    service = new AdminAuditLogService(prisma as unknown as PrismaService);
  });

  it("filters by vendorId (targetId) only", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({ vendorId: "vendor1" });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { targetId: "vendor1" },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
    expect(prisma.adminAuditLog.count).toHaveBeenCalledWith({
      where: { targetId: "vendor1" },
    });
  });

  it("filters by adminId (actorId) only", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({ adminId: "admin1" });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { actorId: "admin1" },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
  });

  it("returns the full platform feed when neither filter is given", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({});

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
  });

  it("combines vendorId and adminId when both given", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({ vendorId: "vendor1", adminId: "admin1" });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { targetId: "vendor1", actorId: "admin1" },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
  });

  it("applies page/pageSize as skip/take, defaulting to page 1 / pageSize 50", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(120);

    const result = await service.list({ page: 3, pageSize: 20 });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      skip: 40,
      take: 20,
    });
    expect(result).toEqual({
      items: [],
      page: 3,
      pageSize: 20,
      total: 120,
    });
  });
});
