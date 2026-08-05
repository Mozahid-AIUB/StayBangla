import { Test } from "@nestjs/testing";
import { TravelerListController } from "./traveler-list.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("TravelerListController", () => {
  let controller: TravelerListController;
  let prisma: { user: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findMany: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [TravelerListController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(TravelerListController);
  });

  it("scopes to TRAVELER role and returns everyone when no filter is given", async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: "t1", roles: [{ role: "TRAVELER" }], passwordHash: "x" },
    ]);

    const result = await controller.list({});

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { roles: { some: { role: "TRAVELER" } } },
    });
    expect(result[0]).not.toHaveProperty("passwordHash");
  });

  it("filters by the synthetic SUSPENDED status", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ status: "SUSPENDED" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        roles: { some: { role: "TRAVELER" } },
        suspendedAt: { not: null },
      },
    });
  });

  it("applies a case-insensitive search across email/fullName/phone", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ search: "karim" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        roles: { some: { role: "TRAVELER" } },
        OR: [
          { email: { contains: "karim", mode: "insensitive" } },
          { fullName: { contains: "karim", mode: "insensitive" } },
          { phone: { contains: "karim", mode: "insensitive" } },
        ],
      },
    });
  });
});
