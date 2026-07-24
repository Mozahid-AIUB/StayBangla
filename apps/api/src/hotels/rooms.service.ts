import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Room } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { HotelsService } from "./hotels.service";

export interface CreateRoomInput {
  roomType: string;
  pricePerNightMinor: number;
  capacity: number;
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
}
