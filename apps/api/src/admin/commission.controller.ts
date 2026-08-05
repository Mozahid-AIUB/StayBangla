import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { User } from "@prisma/client";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateCommissionDto } from "./dto/update-commission.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class CommissionController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary: "Set a vendor's platform commission rate (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Updated commissionRatePercent." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 404, description: "Vendor not found." })
  @Patch(":id/commission")
  async update(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateCommissionDto,
  ): Promise<Pick<User, "id" | "commissionRatePercent">> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Vendor not found");
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { commissionRatePercent: dto.commissionRatePercent },
      select: { id: true, commissionRatePercent: true },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        targetId: id,
        actorId: admin.id,
        action: "COMMISSION_RATE_CHANGED",
        reason: undefined,
        metadata: {
          oldRatePercent: existing.commissionRatePercent,
          newRatePercent: dto.commissionRatePercent,
        },
      },
    });

    return updated;
  }
}
