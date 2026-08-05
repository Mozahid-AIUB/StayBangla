import {
  Body,
  Controller,
  Delete,
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
import { VendorDashboardService } from "./vendor-dashboard.service";
import { VendorLedgerService } from "./vendor-ledger.service";
import { BookingsService } from "../bookings/bookings.service";
import { ListBookingsQueryDto } from "./dto/list-bookings-query.dto";
import { EarningsQueryDto } from "./dto/earnings-query.dto";
import { CreateLedgerEntryDto } from "./dto/create-ledger-entry.dto";
import { CreateOfflineBookingDto } from "./dto/create-offline-booking.dto";

@ApiTags("vendor-dashboard")
@ApiBearerAuth()
@Controller("vendor")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("VENDOR")
export class VendorDashboardController {
  constructor(
    private readonly dashboardService: VendorDashboardService,
    private readonly ledgerService: VendorLedgerService,
    private readonly bookingsService: BookingsService,
  ) {}

  @ApiOperation({ summary: "Get the calling vendor's dashboard summary" })
  @ApiResponse({
    status: 200,
    description:
      "Monthly income, upcoming check-ins (CONFIRMED bookings with a check-in date today or later, Asia/Dhaka), active listings, occupancy/utilization rate, today's check-ins/outs, verification alert.",
  })
  @Get("dashboard/summary")
  async summary(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getSummary(user.id);
  }

  @ApiOperation({
    summary: "List the calling vendor's own hotel rooms or vehicles",
  })
  @ApiResponse({
    status: 200,
    description:
      "Each with active status, photo count, own earnings, own booking count.",
  })
  @Get("listings")
  async listings(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getListings(user.id);
  }

  @ApiOperation({ summary: "List the calling vendor's own bookings" })
  @ApiResponse({
    status: 200,
    description: "Filterable by status, room/vehicle, date range.",
  })
  @Get("bookings")
  async bookings(
    @CurrentUser() user: RequestUser,
    @Query() query: ListBookingsQueryDto,
  ) {
    return this.dashboardService.getBookings(user.id, {
      status: query.status,
      roomId: query.roomId,
      vehicleId: query.vehicleId,
      from: query.from,
      to: query.to,
    });
  }

  @ApiOperation({
    summary: "Get the calling vendor's earnings (online + offline)",
  })
  @ApiResponse({
    status: 200,
    description: "Total, online/offline split, per-listing breakdown.",
  })
  @ApiResponse({ status: 400, description: "Both period and from/to given." })
  @Get("earnings")
  async earnings(
    @CurrentUser() user: RequestUser,
    @Query() query: EarningsQueryDto,
  ) {
    return this.dashboardService.getEarnings(user.id, {
      period: query.period,
      from: query.from,
      to: query.to,
    });
  }

  @ApiOperation({ summary: "Record a manual offline income/expense entry" })
  @ApiResponse({ status: 201, description: "Entry created." })
  @ApiResponse({
    status: 400,
    description:
      "category=WALK_IN_BOOKING, or neither/both of roomId/vehicleId given.",
  })
  @ApiResponse({
    status: 403,
    description: "Caller does not own the referenced room/vehicle.",
  })
  @Post("ledger-entries")
  async createLedgerEntry(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLedgerEntryDto,
  ) {
    return this.ledgerService.create(user.id, dto);
  }

  @ApiOperation({
    summary: "List the calling vendor's own manual ledger entries",
  })
  @ApiResponse({
    status: 200,
    description: "Newest first, excludes soft-deleted entries.",
  })
  @Get("ledger-entries")
  async listLedgerEntries(@CurrentUser() user: RequestUser) {
    return this.ledgerService.list(user.id);
  }

  @ApiOperation({ summary: "Soft-delete a manual ledger entry" })
  @ApiResponse({ status: 201, description: "Entry marked deleted." })
  @ApiResponse({ status: 403, description: "Caller does not own this entry." })
  @Delete("ledger-entries/:id")
  async deleteLedgerEntry(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ) {
    await this.ledgerService.softDelete(user.id, id);
    return { message: "Ledger entry deleted" };
  }

  @ApiOperation({
    summary: "Record an offline (walk-in) booking",
    description:
      "Blocks the room/vehicle's public availability for the given dates and auto-creates a linked WALK_IN_BOOKING ledger entry.",
  })
  @ApiResponse({
    status: 201,
    description: "Booking and linked ledger entry created.",
  })
  @ApiResponse({
    status: 403,
    description: "Caller does not own the room/vehicle.",
  })
  @ApiResponse({
    status: 409,
    description: "Dates overlap an existing booking or block.",
  })
  @Post("bookings/offline")
  async createOfflineBooking(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOfflineBookingDto,
  ) {
    return this.bookingsService.createOfflineBooking(user.id, dto);
  }

  @ApiOperation({ summary: "Cancel an offline (walk-in) booking early" })
  @ApiResponse({
    status: 201,
    description: "Booking cancelled; dates freed for the next search.",
  })
  @ApiResponse({
    status: 409,
    description:
      "Not found, not yours, or not an offline booking in a cancellable state.",
  })
  @Delete("bookings/offline/:id")
  async cancelOfflineBooking(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ) {
    return this.bookingsService.cancelOfflineBooking(user.id, id);
  }
}
