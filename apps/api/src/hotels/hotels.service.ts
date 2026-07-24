import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Hotel,
  HotelPhoto,
  Prisma,
  District,
  FacilityCatalog,
  RoomType,
  Room,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { StoragePort } from "../common/storage/storage.port";

export interface CreateHotelInput {
  name: string;
  city: District;
  address: string;
  description?: string;
  amenities?: FacilityCatalog[];
  starRating?: number;
  checkInTime: string;
  checkOutTime: string;
}

export interface RoomAvailability {
  id: string;
  hotelId: string;
  roomType: RoomType;
  pricePerNightMinor: number;
  currency: string;
  capacity: number;
}

// Mirrors @staybangla/shared-types' HotelWithDetails (packages/shared-types/src/hotel.ts).
// Not compiler-enforced (this package has no dependency on shared-types) — keep the two
// shapes in sync by hand if either changes.
export interface HotelDetailResult extends Hotel {
  rooms: Room[];
  photos: HotelPhoto[];
}

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly storagePort: StoragePort,
  ) {}

  private async assertVerifiedVendor(ownerId: string): Promise<void> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner || owner.verifiedStatus !== "VERIFIED") {
      throw new ForbiddenException("Only verified vendors can create listings");
    }
  }

  async create(ownerId: string, input: CreateHotelInput): Promise<Hotel> {
    await this.assertVerifiedVendor(ownerId);
    return this.prisma.hotel.create({ data: { ownerId, ...input } });
  }

  async findByIdOrThrow(id: string): Promise<Hotel> {
    const hotel = await this.prisma.hotel.findUnique({ where: { id } });
    if (!hotel) throw new NotFoundException("Hotel not found");
    return hotel;
  }

  async findPublicDetailOrThrow(id: string): Promise<HotelDetailResult> {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id },
      include: { rooms: { include: { photos: true } }, photos: true },
    });
    if (!hotel || !hotel.isActive) {
      throw new NotFoundException("Hotel not found");
    }
    return hotel as HotelDetailResult;
  }

  async searchAvailableRooms(
    checkIn: string,
    checkOut: string,
    city?: District,
  ): Promise<RoomAvailability[]> {
    const cityFilter = city
      ? Prisma.sql`AND h.city = ${city}::"District"`
      : Prisma.empty;
    return this.prisma.$queryRaw<RoomAvailability[]>(Prisma.sql`
      SELECT r.id, r.hotel_id AS "hotelId", r.room_type AS "roomType",
             r.price_per_night_minor AS "pricePerNightMinor", r.currency, r.capacity
      FROM rooms r
      JOIN hotels h ON h.id = r.hotel_id
      WHERE r.is_active = true AND h.is_active = true ${cityFilter}
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.room_id = r.id
            AND b.status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
            AND b.date_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')
        )
    `);
  }

  private extensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    return map[contentType] ?? "jpg";
  }

  async presignPhotoUpload(
    callerId: string,
    hotelId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const hotel = await this.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    const ext = this.extensionFromContentType(contentType);
    const objectKey = `hotels/${hotelId}/${randomUUID()}.${ext}`;
    const uploadUrl = await this.storagePort.getPresignedUploadUrl(
      objectKey,
      contentType,
    );
    return { uploadUrl, objectKey };
  }

  async confirmPhoto(
    callerId: string,
    hotelId: string,
    objectKey: string,
    isPrimary: boolean,
  ): Promise<HotelPhoto> {
    const hotel = await this.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    if (isPrimary) {
      await this.prisma.hotelPhoto.updateMany({
        where: { hotelId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return this.prisma.hotelPhoto.create({
      data: { hotelId, objectKey, isPrimary },
    });
  }

  async deletePhoto(
    callerId: string,
    hotelId: string,
    photoId: string,
  ): Promise<void> {
    const hotel = await this.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    const photo = await this.prisma.hotelPhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.hotelId !== hotelId) {
      throw new NotFoundException("Photo not found");
    }
    await this.storagePort.deleteObject(photo.objectKey);
    await this.prisma.hotelPhoto.delete({ where: { id: photoId } });
  }
}
