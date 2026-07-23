import { Body, Controller, Ip, Post, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { Role } from "@prisma/client";
import { OtpRequestDto } from "./dto/otp-request.dto";
import { OtpVerifyDto } from "./dto/otp-verify.dto";
import { OtpService } from "./otp.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";

const REFRESH_COOKIE = "refreshToken";

@Controller("auth/otp")
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Post("request")
  async request(
    @Body() dto: OtpRequestDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.otpService.requestOtp(dto.channel, dto.identifier, ip);
    return { message: "OTP sent" };
  }

  @Post("verify")
  async verify(
    @Body() dto: OtpVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: PublicUser }> {
    await this.otpService.verifyOtp(dto.identifier, dto.otp);

    let user = await this.usersService.findByIdentifier(dto.identifier);
    if (!user) {
      const isEmail = dto.identifier.includes("@");
      user = await this.usersService.create({
        [isEmail ? "email" : "phone"]: dto.identifier,
        role: Role.TRAVELER,
      });
    }

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
