import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BedType, Room, RoomPhoto, RoomType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { HotelsService } from "./hotels.service";
import { StoragePort } from "../common/storage/storage.port";

export interface CreateRoomInput {
  roomType: RoomType;
  pricePerNightMinor: number;
  capacity: number;
  hasAC: boolean;
  bedType: BedType;
  amenities?: string[];
}

export interface UpdateRoomInput {
  pricePerNightMinor?: number;
  isActive?: boolean;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hotelsService: HotelsService,
    private readonly storagePort: StoragePort,
  ) {}

  async create(
    callerId: string,
    hotelId: string,
    input: CreateRoomInput,
  ): Promise<Room> {
    const hotel = await this.hotelsService.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    return this.prisma.room.create({ data: { hotelId, ...input } });
  }

  async update(
    callerId: string,
    roomId: string,
    input: UpdateRoomInput,
  ): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Room not found");

    const hotel = await this.hotelsService.findByIdOrThrow(room.hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    return this.prisma.room.update({ where: { id: roomId }, data: input });
  }

  private extensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    return map[contentType] ?? "jpg";
  }

  private async assertOwnsRoom(
    callerId: string,
    roomId: string,
  ): Promise<{ id: string; hotelId: string }> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Room not found");
    const hotel = await this.hotelsService.findByIdOrThrow(room.hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    return room;
  }

  async presignPhotoUpload(
    callerId: string,
    roomId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    await this.assertOwnsRoom(callerId, roomId);
    const ext = this.extensionFromContentType(contentType);
    const objectKey = `rooms/${roomId}/${randomUUID()}.${ext}`;
    const uploadUrl = await this.storagePort.getPresignedUploadUrl(
      objectKey,
      contentType,
    );
    return { uploadUrl, objectKey };
  }

  async confirmPhoto(
    callerId: string,
    roomId: string,
    objectKey: string,
    isPrimary: boolean,
  ): Promise<RoomPhoto> {
    await this.assertOwnsRoom(callerId, roomId);
    if (isPrimary) {
      await this.prisma.roomPhoto.updateMany({
        where: { roomId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return this.prisma.roomPhoto.create({
      data: { roomId, objectKey, isPrimary },
    });
  }

  async deletePhoto(
    callerId: string,
    roomId: string,
    photoId: string,
  ): Promise<void> {
    await this.assertOwnsRoom(callerId, roomId);
    const photo = await this.prisma.roomPhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.roomId !== roomId) {
      throw new NotFoundException("Photo not found");
    }
    await this.storagePort.deleteObject(photo.objectKey);
    await this.prisma.roomPhoto.delete({ where: { id: photoId } });
  }
}
