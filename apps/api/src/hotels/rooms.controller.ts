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
import { RoomsService } from "./rooms.service";
import { HotelsService, RoomAvailability } from "./hotels.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { SearchAvailableRoomsDto } from "./dto/search-available-rooms.dto";
import { PresignPhotoDto } from "./dto/presign-photo.dto";
import { ConfirmPhotoDto } from "./dto/confirm-photo.dto";

@ApiTags("hotels")
@Controller()
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly hotelsService: HotelsService,
  ) {}

  @ApiOperation({
    summary: "Search for available rooms across all hotels for a date range",
  })
  @ApiResponse({
    status: 200,
    description: "Rooms with no overlapping booking/block for the given dates.",
  })
  @ApiResponse({
    status: 400,
    description: "checkIn is not before checkOut, or a date is in the past.",
  })
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

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Add a room to a hotel (vendor only, must own the hotel)",
  })
  @ApiResponse({ status: 201, description: "Room created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({ status: 404, description: "Hotel not found." })
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

  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a room's price or active status" })
  @ApiResponse({ status: 200, description: "Room updated." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({ status: 404, description: "Room not found." })
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

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get a presigned MinIO upload URL for a room photo",
  })
  @ApiResponse({ status: 201, description: "Presigned URL and objectKey." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({ status: 404, description: "Room not found." })
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

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Confirm a room photo upload after it lands in MinIO",
  })
  @ApiResponse({ status: 201, description: "Photo record created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({
    status: 404,
    description: "Room not found, or the object was never actually uploaded.",
  })
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

  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a room photo" })
  @ApiResponse({ status: 200, description: "Photo deleted." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({ status: 404, description: "Room or photo not found." })
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
