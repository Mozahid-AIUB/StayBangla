import { Body, Controller, Param, Patch, UseGuards } from "@nestjs/common";
import { User } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateCommissionDto } from "./dto/update-commission.dto";

@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class CommissionController {
  constructor(private readonly prisma: PrismaService) {}

  @Patch(":id/commission")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateCommissionDto,
  ): Promise<Pick<User, "id" | "commissionRatePercent">> {
    return this.prisma.user.update({
      where: { id },
      data: { commissionRatePercent: dto.commissionRatePercent },
      select: { id: true, commissionRatePercent: true },
    });
  }
}
