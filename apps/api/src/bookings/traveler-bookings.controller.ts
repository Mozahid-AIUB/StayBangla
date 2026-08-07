import { Controller, Get, Param, UseGuards } from "@nestjs/common";
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
  TravelerBookingRow,
  TravelerBookingsService,
} from "./traveler-bookings.service";

/**
 * A traveller reading their own bookings.
 *
 * Separate from BookingsController, which is where a booking is created,
 * cancelled, paid for and checked in — actions, spanning three roles. This is
 * one traveller reading their own rows, and keeping it apart means the
 * ownership rule lives in one small file rather than being one more branch in
 * a controller that already has several.
 *
 * Until this existed there was no way to retrieve a booking at all: it could be
 * created and paid for, and then the traveller had nothing that would show it
 * to them again.
 */
@ApiTags("bookings")
@ApiBearerAuth()
@Controller("bookings")
export class TravelerBookingsController {
  constructor(private readonly travelerBookings: TravelerBookingsService) {}

  @ApiOperation({
    summary: "List the caller's own bookings, most recent stay first",
  })
  @ApiResponse({
    status: 200,
    description:
      "The caller's bookings. Empty array when they have none — not 404.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller is not a traveler." })
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async list(@CurrentUser() user: RequestUser): Promise<TravelerBookingRow[]> {
    return this.travelerBookings.listForTraveler(user.id);
  }

  @ApiOperation({ summary: "Get one of the caller's own bookings" })
  @ApiResponse({ status: 200, description: "The booking." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller is not a traveler." })
  @ApiResponse({
    status: 404,
    description:
      "No such booking, or it belongs to someone else — deliberately the " +
      "same answer, so the endpoint cannot be used to discover which booking " +
      "ids exist.",
  })
  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async findOne(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<TravelerBookingRow> {
    return this.travelerBookings.findOwnedOrThrow(user.id, id);
  }
}
