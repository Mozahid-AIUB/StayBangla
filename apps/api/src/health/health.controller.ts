import {
  Controller,
  Get,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../common/redis/redis.service";
import { StoragePort } from "../common/storage/storage.port";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";

type ServiceStatus = "ok" | "down";

interface DetailedHealth {
  db: ServiceStatus;
  redis: ServiceStatus;
  minio: ServiceStatus;
}

@ApiTags("Health")
@Controller({ path: "health", version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StoragePort,
  ) {}

  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }

  @Get("db")
  async db(): Promise<{ db: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { db: "ok" };
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Detailed dependency health check (ADMIN/SUPER_ADMIN only)",
    description:
      "Checks Postgres, Redis, and MinIO independently. Each service's " +
      "status is reported even if the others fail. Returns 503 if any " +
      "service is down, 200 if all three are ok.",
  })
  @ApiResponse({ status: 200, description: "All three services are ok." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 503, description: "At least one service is down." })
  @Get("detailed")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  async detailed(@Res() res: Response): Promise<void> {
    const [db, redis, minio] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkMinio(),
    ]);

    const body: DetailedHealth = { db, redis, minio };
    const allOk = db === "ok" && redis === "ok" && minio === "ok";
    res.status(allOk ? 200 : 503).json(body);
  }

  private async checkDb(): Promise<ServiceStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch {
      return "down";
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    try {
      await this.redis.ping();
      return "ok";
    } catch {
      return "down";
    }
  }

  private async checkMinio(): Promise<ServiceStatus> {
    try {
      await this.storage.ensureBucketExists();
      return "ok";
    } catch {
      return "down";
    }
  }
}
