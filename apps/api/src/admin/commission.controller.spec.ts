import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CommissionController } from "./commission.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("CommissionController", () => {
  let controller: CommissionController;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    adminAuditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CommissionController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(CommissionController);
  });

  it("updates the vendor's commissionRatePercent and writes an audit log row with old/new rates", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "vendor1",
      commissionRatePercent: 10,
    });
    prisma.user.update.mockResolvedValue({
      id: "vendor1",
      commissionRatePercent: 15,
    });

    const result = await controller.update(
      { id: "admin1", roles: ["ADMIN"] },
      "vendor1",
      { commissionRatePercent: 15 },
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "vendor1" },
      data: { commissionRatePercent: 15 },
      select: { id: true, commissionRatePercent: true },
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        targetId: "vendor1",
        actorId: "admin1",
        action: "COMMISSION_RATE_CHANGED",
        reason: undefined,
        metadata: { oldRatePercent: 10, newRatePercent: 15 },
      },
    });
    expect(result).toEqual({ id: "vendor1", commissionRatePercent: 15 });
  });

  it("throws NotFoundException when the vendor does not exist, instead of a raw Prisma error", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      controller.update({ id: "admin1", roles: ["ADMIN"] }, "nonexistent", {
        commissionRatePercent: 15,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
