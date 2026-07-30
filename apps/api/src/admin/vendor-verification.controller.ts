import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { VendorVerificationLog } from "@prisma/client";
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
import { VendorVerificationService } from "./vendor-verification.service";
import { RejectVendorDto } from "./dto/reject-vendor.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorVerificationController {
  constructor(
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @ApiOperation({
    summary: "List vendors awaiting verification (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({
    status: 200,
    description: "Vendors with verifiedStatus=PENDING.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("pending")
  async listPending(): Promise<PublicUser[]> {
    const vendors = await this.vendorVerificationService.listPending();
    return vendors.map(toPublicUser);
  }

  @ApiOperation({
    summary: "Approve a pending vendor (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 201, description: "verifiedStatus is now VERIFIED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Vendor is not currently PENDING." })
  @Post(":id/approve")
  async approve(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<PublicUser> {
    const vendor = await this.vendorVerificationService.approve(admin.id, id);
    return toPublicUser(vendor);
  }

  @ApiOperation({
    summary: "Reject a pending vendor with a reason (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 201, description: "verifiedStatus is now REJECTED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Vendor is not currently PENDING." })
  @Post(":id/reject")
  async reject(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: RejectVendorDto,
  ): Promise<PublicUser> {
    const vendor = await this.vendorVerificationService.reject(
      admin.id,
      id,
      dto.reason,
    );
    return toPublicUser(vendor);
  }

  @ApiOperation({
    summary:
      "Get a vendor's full verification history (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({
    status: 200,
    description: "Chronological approve/reject/resubmit log.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get(":id/history")
  async getHistory(@Param("id") id: string): Promise<VendorVerificationLog[]> {
    return this.vendorVerificationService.getHistory(id);
  }
}
