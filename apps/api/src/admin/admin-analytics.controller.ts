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
import {
  AdminAnalyticsService,
  RevenueTrendPoint,
  TopVendorRow,
  DistrictDistributionRow,
} from "./admin-analytics.service";
import {
  RevenueTrendQueryDto,
  TopVendorsQueryDto,
} from "./dto/analytics-query.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  @ApiOperation({
    summary:
      "Platform revenue trend bucketed daily/weekly/monthly (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Revenue trend points." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("revenue-trend")
  async revenueTrend(
    @Query() query: RevenueTrendQueryDto,
  ): Promise<RevenueTrendPoint[]> {
    return this.analyticsService.revenueTrend({
      period: query.period,
      from: query.from,
      to: query.to,
    });
  }

  @ApiOperation({
    summary:
      "Booking counts by status, zero-filled for every BookingStatus value (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Booking status breakdown." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("booking-status-breakdown")
  async bookingStatusBreakdown(): Promise<Record<string, number>> {
    return this.analyticsService.bookingStatusBreakdown();
  }

  @ApiOperation({
    summary: "Top vendors by revenue or booking count (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Ranked vendor rows." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("top-vendors")
  async topVendors(
    @Query() query: TopVendorsQueryDto,
  ): Promise<TopVendorRow[]> {
    return this.analyticsService.topVendors({
      limit: query.limit,
      metric: query.metric,
    });
  }

  @ApiOperation({
    summary:
      "Active hotel/vehicle listing counts per district (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "District distribution rows." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("district-distribution")
  async districtDistribution(): Promise<DistrictDistributionRow[]> {
    return this.analyticsService.districtDistribution();
  }
}
