import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
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
import { VendorSuspensionService } from "./vendor-suspension.service";
import { SuspendVendorDto } from "./dto/suspend-vendor.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorSuspensionController {
  constructor(
    private readonly vendorSuspensionService: VendorSuspensionService,
  ) {}

  @ApiOperation({
    summary: "Suspend a vendor (ADMIN/SUPER_ADMIN only)",
    description:
      "Blocks the vendor's login, new bookings, new listings, and search visibility. Existing CONFIRMED/PAID bookings are unaffected.",
  })
  @ApiResponse({ status: 201, description: "Vendor is now suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Vendor is already suspended." })
  @Post(":id/suspend")
  async suspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: SuspendVendorDto,
  ): Promise<PublicUser> {
    const vendor = await this.vendorSuspensionService.suspend(
      admin.id,
      id,
      dto.reason,
    );
    return toPublicUser(vendor);
  }

  @ApiOperation({ summary: "Unsuspend a vendor (ADMIN/SUPER_ADMIN only)" })
  @ApiResponse({ status: 201, description: "Vendor is no longer suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({
    status: 409,
    description: "Vendor is not currently suspended.",
  })
  @Post(":id/unsuspend")
  async unsuspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<PublicUser> {
    const vendor = await this.vendorSuspensionService.unsuspend(admin.id, id);
    return toPublicUser(vendor);
  }
}
