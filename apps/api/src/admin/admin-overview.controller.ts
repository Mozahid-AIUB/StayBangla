import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  AdminOverviewService,
  PlatformOverview,
} from "./admin-overview.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/overview")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @ApiOperation({
    summary:
      "Platform-wide headline counts and this month's revenue (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Platform overview." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async getOverview(): Promise<PlatformOverview> {
    return this.overviewService.getOverview();
  }
}
