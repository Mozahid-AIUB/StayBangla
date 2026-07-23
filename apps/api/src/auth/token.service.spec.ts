import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "./token.service";

function makeConfig(): ConfigService {
  const values: Record<string, string> = {
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_SECRET: "b".repeat(32),
    JWT_REFRESH_EXPIRES_IN: "30d",
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("TokenService", () => {
  let jwtService: JwtService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: TokenService;

  beforeEach(() => {
    jwtService = new JwtService({});
    prisma = {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new TokenService(
      jwtService,
      makeConfig(),
      prisma as unknown as PrismaService,
    );
  });

  it("issueTokenPair falls back to a 30-day expiry when JWT_REFRESH_EXPIRES_IN is malformed", async () => {
    const badConfig = {
      get: (key: string) =>
        key === "JWT_REFRESH_EXPIRES_IN"
          ? "not-a-duration"
          : makeConfig().get(key as never),
    } as unknown as ConfigService;
    const badService = new TokenService(
      jwtService,
      badConfig,
      prisma as unknown as PrismaService,
    );
    prisma.refreshToken.create.mockResolvedValue({ familyId: "fam-1" });

    await badService.issueTokenPair({ id: "u1", roles: ["TRAVELER"] });

    const createCall = prisma.refreshToken.create.mock.calls[0][0];
    const expiresAt = createCall.data.expiresAt as Date;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThan(
      Date.now() + thirtyDaysMs - 5000,
    );
    expect(expiresAt.getTime()).toBeLessThan(Date.now() + thirtyDaysMs + 5000);
  });

  it("issueTokenPair returns a verifiable access token and persists a refresh token row", async () => {
    prisma.refreshToken.create.mockResolvedValue({ familyId: "fam-1" });

    const pair = await service.issueTokenPair({
      id: "u1",
      roles: ["TRAVELER"],
    });

    const decoded = jwtService.verify(pair.accessToken, {
      secret: "a".repeat(32),
    }) as { sub: string; roles: string[] };
    expect(decoded.sub).toBe("u1");
    expect(decoded.roles).toEqual(["TRAVELER"]);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(pair.refreshToken).toEqual(expect.any(String));
  });

  it("rotateRefreshToken issues a new pair and revokes the old row, keeping the same family", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      familyId: "fam-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    prisma.refreshToken.create.mockResolvedValue({ familyId: "fam-1" });

    await service.rotateRefreshToken("some-refresh-token", async () => ({
      id: "u1",
      roles: ["TRAVELER"],
    }));

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "rt1" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ familyId: "fam-1" }),
      }),
    );
  });

  it("rotateRefreshToken on an already-revoked token revokes the entire family (reuse detection)", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      familyId: "fam-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    await expect(
      service.rotateRefreshToken("reused-token", async () => ({
        id: "u1",
        roles: ["TRAVELER"],
      })),
    ).rejects.toThrow(/reuse/i);

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("rotateRefreshToken on an expired token throws and does not rotate", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      familyId: "fam-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.rotateRefreshToken("expired-token", async () => ({
        id: "u1",
        roles: ["TRAVELER"],
      })),
    ).rejects.toThrow(/expired/i);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("rotateRefreshToken throws for a token that does not exist at all", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(
      service.rotateRefreshToken("unknown-token", async () => ({
        id: "u1",
        roles: ["TRAVELER"],
      })),
    ).rejects.toThrow(/invalid/i);
  });

  it("revokeFamilyByToken revokes every row in the family (logout)", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      familyId: "fam-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000),
    });
    await service.revokeFamilyByToken("some-refresh-token");
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("revokeFamilyByToken is a no-op when the token does not exist", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await service.revokeFamilyByToken("unknown-token");
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
