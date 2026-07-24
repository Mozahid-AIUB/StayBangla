import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  let service: UsersService;
  let prisma: {
    user: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it("findByIdentifier finds a user by email or phone", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "u1", email: "a@b.com" });
    const result = await service.findByIdentifier("a@b.com");
    expect(result).toEqual({ id: "u1", email: "a@b.com" });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: "a@b.com" }, { phone: "a@b.com" }] },
      include: { roles: true },
    });
  });

  it("findByIdentifier returns null when not found", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const result = await service.findByIdentifier("nobody@nowhere.com");
    expect(result).toBeNull();
  });

  it("findById delegates to prisma.user.findUnique", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1" });
    const result = await service.findById("u1");
    expect(result).toEqual({ id: "u1" });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
    });
  });

  it("create wires role creation via the roles relation", async () => {
    prisma.user.create.mockResolvedValue({ id: "u1" });
    await service.create({
      email: "v@e.com",
      passwordHash: "hash",
      fullName: "V",
      role: "VENDOR" as never,
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "v@e.com",
        passwordHash: "hash",
        fullName: "V",
        roles: { create: [{ role: "VENDOR" }] },
      }),
    });
  });

  it("updateProfile delegates to prisma.user.update", async () => {
    prisma.user.update.mockResolvedValue({ id: "u1", fullName: "New Name" });
    const result = await service.updateProfile("u1", { fullName: "New Name" });
    expect(result).toEqual({ id: "u1", fullName: "New Name" });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { fullName: "New Name" },
    });
  });
});
