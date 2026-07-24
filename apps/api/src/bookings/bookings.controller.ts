import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { BookingsService } from "./bookings.service";
import { BookingRecord } from "./bookings.types";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { CreateBlockDto } from "./dto/create-block.dto";

@Controller()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post("bookings")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.createBooking(user.id, dto);
  }

  @Post("bookings/:id/confirm-payment")
  @UseGuards(JwtAuthGuard)
  async confirmPayment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<BookingRecord> {
    return this.bookingsService.confirmPayment(user.id, id);
  }

  @Post("bookings/:id/checkout")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async checkout(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<BookingRecord> {
    return this.bookingsService.checkout(user.id, id);
  }

  @Post("bookings/:id/cancel")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<BookingRecord> {
    return this.bookingsService.cancel(user.id, id);
  }

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
