import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { TravelerListQueryDto } from "./dto/traveler-list-query.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/travelers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class TravelerListController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary:
      "List travelers, filterable by status=SUSPENDED and search (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Matching travelers." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(@Query() query: TravelerListQueryDto): Promise<PublicUser[]> {
    const where: Record<string, unknown> = {
      roles: { some: { role: "TRAVELER" } },
    };

    if (query.status === "SUSPENDED") {
      where.suspendedAt = { not: null };
    }

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { fullName: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const travelers = await this.prisma.user.findMany({ where });
    return travelers.map(toPublicUser);
  }
}
