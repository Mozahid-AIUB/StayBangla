import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Room } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { RoomsService } from "./rooms.service";
import { HotelsService, RoomAvailability } from "./hotels.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";

@Controller()
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly hotelsService: HotelsService,
  ) {}

  @Get("rooms/available")
  async available(
    @Query("checkIn") checkIn: string,
    @Query("checkOut") checkOut: string,
    @Query("city") city?: string,
  ): Promise<RoomAvailability[]> {
    return this.hotelsService.searchAvailableRooms(checkIn, checkOut, city);
  }

  @Post("hotels/:hotelId/rooms")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Param("hotelId") hotelId: string,
    @Body() dto: CreateRoomDto,
  ): Promise<Room> {
    return this.roomsService.create(user.id, hotelId, dto);
  }

  @Patch("rooms/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<Room> {
    return this.roomsService.update(user.id, id, dto);
  }
}
