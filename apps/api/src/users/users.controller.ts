import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/decorators/check-policies.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { UsersService } from "./users.service";
import { VendorVerificationService } from "../admin/vendor-verification.service";
import { toPublicUser, PublicUser } from "./to-public-user";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  async me(@CurrentUser() user: RequestUser): Promise<PublicUser> {
    const found = await this.usersService.findById(user.id);
    return toPublicUser(found!);
  }

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

  @Post("me/resubmit")
  @UseGuards(JwtAuthGuard, RolesGuard)
  async resubmit(@CurrentUser() user: RequestUser): Promise<PublicUser> {
    const updated = await this.vendorVerificationService.resubmit(user.id);
    return toPublicUser(updated);
  }
}
