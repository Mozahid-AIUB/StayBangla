import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";

@Controller({ path: "health", version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }

  @Get("db")
  async db(): Promise<{ db: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { db: "ok" };
  }
}
