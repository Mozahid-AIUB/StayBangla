import { randomUUID, randomBytes, createHash } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";

export interface TokenSubject {
  id: string;
  roles: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private signAccessToken(subject: TokenSubject): string {
    const signOptions: JwtSignOptions = {
      secret: this.config.get<string>("JWT_ACCESS_SECRET"),
      expiresIn: this.config.get<string>(
        "JWT_ACCESS_EXPIRES_IN",
        "15m",
      ) as JwtSignOptions["expiresIn"],
    };
    return this.jwtService.sign(
      { sub: subject.id, roles: subject.roles },
      signOptions,
    );
  }

  private parseDurationMs(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
      match[2] as "s" | "m" | "h" | "d"
    ];
    return value * unitMs;
  }

  private async persistRefreshToken(
    userId: string,
    familyId: string,
  ): Promise<string> {
    const refreshToken = randomBytes(48).toString("hex");
    const refreshExpiresIn = this.config.get<string>(
      "JWT_REFRESH_EXPIRES_IN",
      "30d",
    );
    const expiresAt = new Date(
      Date.now() + this.parseDurationMs(refreshExpiresIn),
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt,
      },
    });

    return refreshToken;
  }

  async issueTokenPair(subject: TokenSubject): Promise<TokenPair> {
    const familyId = randomUUID();
    const accessToken = this.signAccessToken(subject);
    const refreshToken = await this.persistRefreshToken(subject.id, familyId);
    return { accessToken, refreshToken };
  }

  async rotateRefreshToken(
    presentedToken: string,
    loadSubject: (userId: string) => Promise<TokenSubject>,
  ): Promise<TokenPair> {
    const tokenHash = this.hashToken(presentedToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!existing) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        "Refresh token reuse detected — session revoked (reuse)",
      );
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token has expired (expired)");
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const subject = await loadSubject(existing.userId);
    const accessToken = this.signAccessToken(subject);
    const refreshToken = await this.persistRefreshToken(
      subject.id,
      existing.familyId,
    );

    return { accessToken, refreshToken };
  }

  async revokeFamilyByToken(presentedToken: string): Promise<void> {
    const tokenHash = this.hashToken(presentedToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!existing) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId },
      data: { revokedAt: new Date() },
    });
  }
}
