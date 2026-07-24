import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Room, RoomPhoto } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { RoomsService } from "./rooms.service";
import { HotelsService, RoomAvailability } from "./hotels.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { SearchAvailableRoomsDto } from "./dto/search-available-rooms.dto";
import { PresignPhotoDto } from "./dto/presign-photo.dto";
import { ConfirmPhotoDto } from "./dto/confirm-photo.dto";

@Controller()
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly hotelsService: HotelsService,
  ) {}

  @Get("rooms/available")
  async available(
    @Query() query: SearchAvailableRoomsDto,
  ): Promise<RoomAvailability[]> {
    return this.hotelsService.searchAvailableRooms(
      query.checkIn,
      query.checkOut,
      query.city,
    );
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

  @Post("rooms/:id/photos/presign")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async presignPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: PresignPhotoDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return this.roomsService.presignPhotoUpload(user.id, id, dto.contentType);
  }

  @Post("rooms/:id/photos/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async confirmPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: ConfirmPhotoDto,
  ): Promise<RoomPhoto> {
    return this.roomsService.confirmPhoto(
      user.id,
      id,
      dto.objectKey,
      dto.isPrimary ?? false,
    );
  }

  @Delete("rooms/:id/photos/:photoId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async deletePhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("photoId") photoId: string,
  ): Promise<void> {
    return this.roomsService.deletePhoto(user.id, id, photoId);
  }
}
