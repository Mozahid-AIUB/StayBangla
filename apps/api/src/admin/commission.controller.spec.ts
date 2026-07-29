import { Test } from "@nestjs/testing";
import { CommissionController } from "./commission.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("CommissionController", () => {
  let controller: CommissionController;
  let prisma: { user: { update: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { update: jest.fn() } };
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

  it("updates the vendor's commissionRatePercent", async () => {
    prisma.user.update.mockResolvedValue({
      id: "vendor1",
      commissionRatePercent: 15,
    });

    const result = await controller.update("vendor1", {
      commissionRatePercent: 15,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "vendor1" },
      data: { commissionRatePercent: 15 },
      select: { id: true, commissionRatePercent: true },
    });
    expect(result).toEqual({ id: "vendor1", commissionRatePercent: 15 });
  });
});
