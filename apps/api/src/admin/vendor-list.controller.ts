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
import { VendorListQueryDto } from "./dto/vendor-list-query.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorListController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary:
      "List vendors, filterable by status (PENDING/VERIFIED/REJECTED/SUSPENDED) and search (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Matching vendors." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(@Query() query: VendorListQueryDto): Promise<PublicUser[]> {
    const where: Record<string, unknown> = {};

    if (query.status === "SUSPENDED") {
      where.suspendedAt = { not: null };
    } else if (query.status) {
      where.verifiedStatus = query.status;
    }

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { fullName: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const vendors = await this.prisma.user.findMany({ where });
    return vendors.map(toPublicUser);
  }
}
