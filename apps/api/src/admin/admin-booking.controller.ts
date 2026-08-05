import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
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
import {
  AdminBookingService,
  AdminBookingListResult,
} from "./admin-booking.service";
import { AdminBookingListQueryDto } from "./dto/admin-booking-list-query.dto";
import { ForceCancelBookingDto } from "./dto/force-cancel-booking.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/bookings")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminBookingController {
  constructor(private readonly adminBookingService: AdminBookingService) {}

  @ApiOperation({
    summary:
      "Platform-wide booking list, filterable by status/district/date-range (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Paginated bookings." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(
    @Query() query: AdminBookingListQueryDto,
  ): Promise<AdminBookingListResult> {
    return this.adminBookingService.list({
      status: query.status,
      district: query.district,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @ApiOperation({
    summary:
      "Force-cancel a booking (ADMIN/SUPER_ADMIN only). Never touches paymentStatus or triggers a refund.",
  })
  @ApiResponse({ status: 201, description: "Booking is now CANCELLED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({
    status: 409,
    description: "Booking is not in a cancellable state.",
  })
  @Post(":id/force-cancel")
  async forceCancel(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: ForceCancelBookingDto,
  ): Promise<void> {
    await this.adminBookingService.forceCancel(admin.id, id, dto.reason);
  }
}
