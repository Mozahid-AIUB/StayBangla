import {
  Body,
  Controller,
  ForbiddenException,
  Ip,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { Role } from "@prisma/client";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { OtpRequestDto } from "./dto/otp-request.dto";
import { OtpVerifyDto } from "./dto/otp-verify.dto";
import { OtpService } from "./otp.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";
import { IdentifierThrottlerGuard } from "../common/throttler/identifier-throttler.guard";

const REFRESH_COOKIE = "refreshToken";

@ApiTags("auth")
@Controller("auth/otp")
@UseGuards(IdentifierThrottlerGuard)
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  @ApiOperation({
    summary: "Request a one-time password",
    description:
      "Sends a 6-digit OTP via SMS or email to the given identifier. " +
      "Rate-limited to 5 requests/minute per IP on top of the OtpService's " +
      "own per-identifier cooldown.",
  })
  @ApiResponse({ status: 201, description: "OTP sent." })
  @ApiResponse({ status: 400, description: "Invalid channel or identifier." })
  @ApiTooManyRequestsResponse({
    description:
      "Too many OTP requests (5/min per IP, or per-identifier cooldown).",
  })
  @Post("request")
  @Throttle({
    default: { limit: 5, ttl: 60000 },
  })
  async request(
    @Body() dto: OtpRequestDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.otpService.requestOtp(dto.channel, dto.identifier, ip);
    return { message: "OTP sent" };
  }

  @ApiOperation({
    summary: "Verify a one-time password and issue tokens",
    description:
      "On success, creates a new TRAVELER account if the identifier has " +
      "never been seen before, then issues an access token (returned in " +
      "the body) and a refresh token (set as an httpOnly cookie). Only " +
      "pure-TRAVELER accounts (no password set, no non-TRAVELER role) can " +
      "authenticate through this passwordless flow — VENDOR/GUIDE/ADMIN " +
      "accounts must use POST /auth/login.",
  })
  @ApiResponse({ status: 201, description: "OTP verified; tokens issued." })
  @ApiResponse({ status: 400, description: "Incorrect OTP." })
  @ApiResponse({ status: 410, description: "OTP expired or never requested." })
  @ApiResponse({
    status: 403,
    description:
      "This identifier belongs to a password-based account (VENDOR/GUIDE/" +
      "ADMIN/SUPER_ADMIN) and cannot be used with the OTP flow.",
  })
  @ApiTooManyRequestsResponse({
    description:
      "Too many verify attempts for this identifier (10/min), independent " +
      "of the caller's IP — closes the IP-rotation gap in OtpService's own " +
      "per-identifier attempt lockout. Deliberately set above " +
      "OTP_MAX_ATTEMPTS (5) so the HTTP-layer throttle does not mask the " +
      "service-layer lockout's own 401/expired-window response; the " +
      "service-layer lockout (bounded per identifier per hour) is the " +
      "real backstop against guessing, not this per-minute HTTP limit.",
  })
  @Post("verify")
  @Throttle({
    // 20/min, not 10: this decorator is read by BOTH the class-level
    // IdentifierThrottlerGuard (keyed by identifier) and the global
    // APP_GUARD ThrottlerGuard (keyed by IP). The IP bucket is shared across
    // every e2e spec in a run and nothing clears it — cleanOtpKeys() globs
    // `otp:*` while throttler keys are sha256 digests in a disjoint
    // namespace — so a limit of 10 left the suite with zero headroom and any
    // added verify call would surface as a 429 masquerading as flake. Still
    // 5x tighter than the 100/min global default, and the real backstop
    // against guessing is the per-identifier attempt counter below, not this
    // per-minute HTTP limit.
    default: { limit: 20, ttl: 60000 },
  })
  async verify(
    @Body() dto: OtpVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: PublicUser }> {
    await this.otpService.verifyOtp(dto.identifier, dto.otp);

    const existing = await this.usersService.findByIdentifier(dto.identifier);

    // The caller has just proven control of this identifier's inbox/phone by
    // receiving and re-entering the OTP, so telling them precisely why they
    // were rejected does not open a fresh enumeration channel the way it
    // would pre-authentication (see the timing oracle on POST /auth/login).
    // A password-based account (non-null passwordHash) or a role other than
    // TRAVELER must not be reachable through the passwordless flow.
    if (existing) {
      const roles = existing.roles.map((r) => r.role);
      const isPureTraveler =
        existing.passwordHash === null &&
        roles.every((role) => role === Role.TRAVELER);
      if (!isPureTraveler) {
        throw new ForbiddenException(
          "This account uses password login — use POST /auth/login instead",
        );
      }
    }

    const user =
      existing ??
      (await this.usersService.create({
        [dto.identifier.includes("@") ? "email" : "phone"]: dto.identifier,
        role: Role.TRAVELER,
      }));

    // Derive roles from the user's actual roles rather than hardcoding
    // ["TRAVELER"], matching the shape CredentialsService.login() builds —
    // otherwise a traveler holding an additional role would be silently
    // downgraded by the OTP path. isPureTraveler above already guarantees
    // every role here is TRAVELER for an existing user; a freshly created
    // user has exactly one TRAVELER role.
    const roles = existing
      ? existing.roles.map((r) => r.role)
      : [Role.TRAVELER];

    const { accessToken, refreshToken } =
      await this.tokenService.issueTokenPair({
        id: user.id,
        roles,
      });

    const isProduction = this.config.get<string>("NODE_ENV") === "production";
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return { accessToken, user: toPublicUser(user) };
  }
}
