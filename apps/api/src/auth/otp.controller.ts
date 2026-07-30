import { Body, Controller, Ip, Post, Res } from "@nestjs/common";
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

const REFRESH_COOKIE = "refreshToken";

@ApiTags("auth")
@Controller("auth/otp")
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
      "the body) and a refresh token (set as an httpOnly cookie).",
  })
  @ApiResponse({ status: 201, description: "OTP verified; tokens issued." })
  @ApiResponse({ status: 400, description: "Incorrect OTP." })
  @ApiResponse({ status: 410, description: "OTP expired or never requested." })
  @Post("verify")
  async verify(
    @Body() dto: OtpVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: PublicUser }> {
    await this.otpService.verifyOtp(dto.identifier, dto.otp);

    const existing = await this.usersService.findByIdentifier(dto.identifier);
    const user =
      existing ??
      (await this.usersService.create({
        [dto.identifier.includes("@") ? "email" : "phone"]: dto.identifier,
        role: Role.TRAVELER,
      }));

    const { accessToken, refreshToken } =
      await this.tokenService.issueTokenPair({
        id: user.id,
        roles: ["TRAVELER"],
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
