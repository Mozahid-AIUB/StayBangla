import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { SuspensionGuard } from "../auth/guards/suspension.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { BookingsService } from "./bookings.service";
import { BookingRecord } from "./bookings.types";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { CreateBlockDto } from "./dto/create-block.dto";
import { CancelBookingDto } from "./dto/cancel-booking.dto";

@ApiTags("bookings")
@ApiBearerAuth()
@Controller()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @ApiOperation({
    summary: "Create a HELD booking for a room or vehicle (traveler only)",
  })
  @ApiResponse({
    status: 201,
    description: "Booking created with status=HELD.",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid dates, or guestCount exceeds capacity.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 404,
    description: "Room or vehicle not found or inactive.",
  })
  @ApiResponse({
    status: 409,
    description: "Dates overlap an existing booking or vendor block.",
  })
  @Post("bookings")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.createBooking(user.id, dto);
  }

  @ApiOperation({
    summary: "Start a SSLCommerz payment session for a HELD booking",
    description:
      "Redirect the traveler's browser to the returned gatewayUrl to complete payment.",
  })
  @ApiResponse({
    status: 201,
    description: "SSLCommerz gatewayUrl to redirect to.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this booking.",
  })
  @ApiResponse({ status: 404, description: "Booking not found." })
  @ApiResponse({ status: 409, description: "Booking is not in HELD state." })
  @Post("bookings/:id/initiate-payment")
  @UseGuards(JwtAuthGuard, RolesGuard, SuspensionGuard)
  @Roles("TRAVELER")
  async initiatePayment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ gatewayUrl: string }> {
    return this.bookingsService.initiatePayment(user.id, id);
  }

  @ApiOperation({ summary: "Get a booking's current payment status" })
  @ApiResponse({
    status: 200,
    description: "paymentStatus (PENDING/PAID/FAILED) and gatewayTranId.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this booking.",
  })
  @ApiResponse({ status: 404, description: "Booking not found." })
  @Get("bookings/:id/payment-status")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async getPaymentStatus(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ paymentStatus: string; gatewayTranId: string | null }> {
    return this.bookingsService.getPaymentStatus(user.id, id);
  }

  @ApiOperation({
    summary: "Mark a CONFIRMED booking as COMPLETED (vendor only)",
  })
  @ApiResponse({ status: 201, description: "Booking status is now COMPLETED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 409,
    description:
      "Booking not found, not yours, or not in a checkout-eligible state.",
  })
  @Post("bookings/:id/checkout")
  @UseGuards(JwtAuthGuard, RolesGuard, SuspensionGuard)
  @Roles("VENDOR")
  async checkout(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<BookingRecord> {
    return this.bookingsService.checkout(user.id, id);
  }

  @ApiOperation({
    summary: "Cancel a booking",
    description:
      "A HELD booking cancels freely (no charge was ever completed). " +
      "A CONFIRMED+PAID booking forfeits the payment — no refund is " +
      "issued — and requires acknowledgeNoRefund: true in the body.",
  })
  @ApiResponse({ status: 201, description: "Booking status is now CANCELLED." })
  @ApiResponse({
    status: 400,
    description:
      "CONFIRMED+PAID cancellation attempted without acknowledgeNoRefund.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 409,
    description: "Booking not found, not yours, or not cancellable.",
  })
  @Post("bookings/:id/cancel")
  @UseGuards(JwtAuthGuard, RolesGuard, SuspensionGuard)
  @Roles("TRAVELER")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: CancelBookingDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.cancel(user.id, id, dto.acknowledgeNoRefund);
  }

  @ApiOperation({
    summary: "Block off dates on a vendor's own room or vehicle (vendor only)",
    description:
      "Used for maintenance/personal blackout dates, not a real booking — no traveler, no payment.",
  })
  @ApiResponse({
    status: 201,
    description: "Block created with status=BLOCKED.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this room/vehicle.",
  })
  @ApiResponse({ status: 404, description: "Room or vehicle not found." })
  @ApiResponse({
    status: 409,
    description: "Dates overlap an existing booking or block.",
  })
  @Post("vendor/blocks")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async createBlock(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBlockDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.createBlock(user.id, dto);
  }
}
