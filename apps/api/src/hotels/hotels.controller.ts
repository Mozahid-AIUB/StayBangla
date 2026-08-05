import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Hotel, HotelPhoto } from "@prisma/client";
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
import { HotelsService, HotelDetailResult } from "./hotels.service";
import { CreateHotelDto } from "./dto/create-hotel.dto";
import { PresignPhotoDto } from "./dto/presign-photo.dto";
import { ConfirmPhotoDto } from "./dto/confirm-photo.dto";

@ApiTags("hotels")
@Controller("hotels")
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @ApiOperation({ summary: "Get a hotel's public detail page" })
  @ApiResponse({
    status: 200,
    description: "Hotel detail with photos and active rooms.",
  })
  @ApiResponse({ status: 404, description: "Hotel not found." })
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<HotelDetailResult> {
    return this.hotelsService.findPublicDetailOrThrow(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a hotel listing (vendor only)" })
  @ApiResponse({ status: 201, description: "Hotel created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not a VENDOR, or is not yet verified.",
  })
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateHotelDto,
  ): Promise<Hotel> {
    return this.hotelsService.create(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get a presigned MinIO upload URL for a hotel photo",
    description:
      "Upload the file directly to uploadUrl, then call POST /:id/photos/confirm with the returned objectKey.",
  })
  @ApiResponse({ status: 201, description: "Presigned URL and objectKey." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({ status: 404, description: "Hotel not found." })
  @Post(":id/photos/presign")
  @UseGuards(JwtAuthGuard, RolesGuard, SuspensionGuard)
  @Roles("VENDOR")
  async presignPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: PresignPhotoDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return this.hotelsService.presignPhotoUpload(user.id, id, dto.contentType);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Confirm a hotel photo upload after it lands in MinIO",
  })
  @ApiResponse({ status: 201, description: "Photo record created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({
    status: 404,
    description: "Hotel not found, or the object was never actually uploaded.",
  })
  @Post(":id/photos/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard, SuspensionGuard)
  @Roles("VENDOR")
  async confirmPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: ConfirmPhotoDto,
  ): Promise<HotelPhoto> {
    return this.hotelsService.confirmPhoto(
      user.id,
      id,
      dto.objectKey,
      dto.isPrimary ?? false,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a hotel photo" })
  @ApiResponse({ status: 200, description: "Photo deleted." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({ status: 404, description: "Hotel or photo not found." })
  @Delete(":id/photos/:photoId")
  @UseGuards(JwtAuthGuard, RolesGuard, SuspensionGuard)
  @Roles("VENDOR")
  async deletePhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("photoId") photoId: string,
  ): Promise<void> {
    return this.hotelsService.deletePhoto(user.id, id, photoId);
  }
}
