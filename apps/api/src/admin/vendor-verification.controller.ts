import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { User, VendorVerificationLog } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VendorVerificationService } from "./vendor-verification.service";
import { RejectVendorDto } from "./dto/reject-vendor.dto";

@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorVerificationController {
  constructor(
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @Get("pending")
  async listPending(): Promise<User[]> {
    return this.vendorVerificationService.listPending();
  }

  @Post(":id/approve")
  async approve(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<User> {
    return this.vendorVerificationService.approve(admin.id, id);
  }

  @Post(":id/reject")
  async reject(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: RejectVendorDto,
  ): Promise<User> {
    return this.vendorVerificationService.reject(admin.id, id, dto.reason);
  }

  @Get(":id/history")
  async getHistory(@Param("id") id: string): Promise<VendorVerificationLog[]> {
    return this.vendorVerificationService.getHistory(id);
  }
}
