import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { CredentialsService } from "./credentials.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";

const REFRESH_COOKIE = "refreshToken";

@ApiTags("auth")
@Controller("auth")
export class CredentialsController {
  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    const isProduction = this.config.get<string>("NODE_ENV") === "production";
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  @ApiOperation({
    summary: "Register a vendor or guide account",
    description:
      "Traveler accounts are never created here — they self-provision via OTP verify.",
  })
  @ApiResponse({
    status: 201,
    description: "Account created with verifiedStatus=PENDING.",
  })
  @ApiResponse({ status: 409, description: "Email already registered." })
  @Post("register")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(@Body() dto: RegisterDto): Promise<PublicUser> {
    const user = await this.credentialsService.register(dto);
    return toPublicUser(user);
  }

  @ApiOperation({
    summary: "Log in with email + password (vendor/guide/admin)",
  })
  @ApiResponse({
    status: 201,
    description: "Access token returned; refresh token set as httpOnly cookie.",
  })
  @ApiResponse({ status: 401, description: "Invalid credentials." })
  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.credentialsService.login(
      dto.identifier,
      dto.password,
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @ApiOperation({
    summary: "Rotate the refresh-token cookie and issue a new access token",
    description:
      "Reusing an already-rotated refresh token revokes its entire token family (reuse detection).",
  })
  @ApiResponse({
    status: 201,
    description: "New access token issued; refresh cookie rotated.",
  })
  @ApiResponse({
    status: 401,
    description: "Missing, expired, or reused refresh token.",
  })
  @Post("refresh")
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (!presented) {
      throw new UnauthorizedException("Missing refresh token");
    }

    const { accessToken, refreshToken } =
      await this.tokenService.rotateRefreshToken(presented, async (userId) => {
        const user = await this.usersService.findById(userId);
        if (user?.suspendedAt) {
          throw new UnauthorizedException(
            "This account is suspended and cannot refresh its session",
          );
        }
        const roles =
          (user as { roles?: { role: string }[] } | null)?.roles?.map(
            (r) => r.role,
          ) ?? [];
        return { id: userId, roles };
      });

    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @ApiOperation({
    summary:
      "Log out — revokes the current refresh-token family and clears the cookie",
  })
  @ApiResponse({
    status: 201,
    description: "Logged out (idempotent — no error if already logged out).",
  })
  @Post("logout")
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (presented) {
      await this.tokenService.revokeFamilyByToken(presented);
    }
    res.clearCookie(REFRESH_COOKIE);
    return { message: "Logged out" };
  }
}
