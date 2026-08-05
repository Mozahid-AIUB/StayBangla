import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/decorators/check-policies.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { UsersService } from "./users.service";
import { VendorVerificationService } from "../admin/vendor-verification.service";
import { toPublicUser, PublicUser } from "./to-public-user";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @ApiOperation({ summary: "Get the current authenticated user's profile" })
  @ApiResponse({
    status: 200,
    description: "The caller's own profile (passwordHash never included).",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  async me(@CurrentUser() user: RequestUser): Promise<PublicUser> {
    const found = await this.usersService.findById(user.id);
    return toPublicUser(found!);
  }

  @ApiOperation({ summary: "Update the current authenticated user's profile" })
  @ApiResponse({ status: 200, description: "Updated profile." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @Patch("me")
  @UseGuards(JwtAuthGuard, PoliciesGuard)
  @CheckPolicies((ability, request) =>
    ability.can("update", { __caslSubjectType__: "User", id: request.user.id }),
  )
  async updateMe(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const updated = await this.usersService.updateProfile(user.id, dto);
    return toPublicUser(updated);
  }

  @ApiOperation({
    summary: "Resubmit a previously-rejected vendor application",
    description:
      "Flips verifiedStatus back to PENDING so an admin can re-review it.",
  })
  @ApiResponse({
    status: 201,
    description: "Resubmitted; status is now PENDING.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 409,
    description: "Only a REJECTED vendor can resubmit.",
  })
  @Post("me/resubmit")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR", "GUIDE")
  async resubmit(@CurrentUser() user: RequestUser): Promise<PublicUser> {
    const updated = await this.vendorVerificationService.resubmit(user.id);
    return toPublicUser(updated);
  }
}
