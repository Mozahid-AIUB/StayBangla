import { Test } from "@nestjs/testing";
import { VendorListController } from "./vendor-list.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VendorListController", () => {
  let controller: VendorListController;
  let prisma: { user: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findMany: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [VendorListController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VendorListController);
  });

  it("filters by ordinary verifiedStatus values", async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: "v1", verifiedStatus: "PENDING", passwordHash: "x" },
    ]);

    const result = await controller.list({ status: "PENDING" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { verifiedStatus: "PENDING" },
    });
    expect(result[0]).not.toHaveProperty("passwordHash");
  });

  it("filters by the synthetic SUSPENDED status", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ status: "SUSPENDED" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { suspendedAt: { not: null } },
    });
  });

  it("applies a case-insensitive search across email/fullName/phone", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ search: "acme" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: { contains: "acme", mode: "insensitive" } },
          { fullName: { contains: "acme", mode: "insensitive" } },
          { phone: { contains: "acme", mode: "insensitive" } },
        ],
      },
    });
  });

  it("combines status and search", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ status: "VERIFIED", search: "acme" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        verifiedStatus: "VERIFIED",
        OR: [
          { email: { contains: "acme", mode: "insensitive" } },
          { fullName: { contains: "acme", mode: "insensitive" } },
          { phone: { contains: "acme", mode: "insensitive" } },
        ],
      },
    });
  });

  it("returns everyone when no filter is given", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({});

    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: {} });
  });
});
