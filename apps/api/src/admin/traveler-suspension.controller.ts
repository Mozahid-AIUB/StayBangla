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
@Controller("admin/travelers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class TravelerSuspensionController {
  constructor(
    private readonly vendorSuspensionService: VendorSuspensionService,
  ) {}

  @ApiOperation({
    summary: "Suspend a traveler (ADMIN/SUPER_ADMIN only)",
    description:
      "Blocks the traveler's login and new booking creation. Existing CONFIRMED/PAID bookings are unaffected. Reuses the same suspension mechanism as vendor suspension.",
  })
  @ApiResponse({ status: 201, description: "Traveler is now suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Traveler is already suspended." })
  @Post(":id/suspend")
  async suspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: SuspendVendorDto,
  ): Promise<PublicUser> {
    const traveler = await this.vendorSuspensionService.suspend(
      admin.id,
      id,
      dto.reason,
      "TRAVELER_SUSPENDED",
    );
    return toPublicUser(traveler);
  }

  @ApiOperation({ summary: "Unsuspend a traveler (ADMIN/SUPER_ADMIN only)" })
  @ApiResponse({ status: 201, description: "Traveler is no longer suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({
    status: 409,
    description: "Traveler is not currently suspended.",
  })
  @Post(":id/unsuspend")
  async unsuspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<PublicUser> {
    const traveler = await this.vendorSuspensionService.unsuspend(
      admin.id,
      id,
      "TRAVELER_UNSUSPENDED",
    );
    return toPublicUser(traveler);
  }
}
