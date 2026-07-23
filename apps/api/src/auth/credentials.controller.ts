import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { CredentialsService } from "./credentials.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";

const REFRESH_COOKIE = "refreshToken";

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

  @Post("register")
  async register(@Body() dto: RegisterDto): Promise<PublicUser> {
    const user = await this.credentialsService.register(dto);
    return toPublicUser(user);
  }

  @Post("login")
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
        const roles =
          (user as { roles?: { role: string }[] } | null)?.roles?.map(
            (r) => r.role,
          ) ?? [];
        return { id: userId, roles };
      });

    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

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
