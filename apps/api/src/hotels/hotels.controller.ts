import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Hotel, HotelPhoto } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { HotelsService } from "./hotels.service";
import { CreateHotelDto } from "./dto/create-hotel.dto";
import { PresignPhotoDto } from "./dto/presign-photo.dto";
import { ConfirmPhotoDto } from "./dto/confirm-photo.dto";

@Controller("hotels")
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateHotelDto,
  ): Promise<Hotel> {
    return this.hotelsService.create(user.id, dto);
  }

  @Post(":id/photos/presign")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async presignPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: PresignPhotoDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return this.hotelsService.presignPhotoUpload(user.id, id, dto.contentType);
  }

  @Post(":id/photos/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
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

  @Delete(":id/photos/:photoId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async deletePhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("photoId") photoId: string,
  ): Promise<void> {
    return this.hotelsService.deletePhoto(user.id, id, photoId);
  }
}
