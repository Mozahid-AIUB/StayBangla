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
import { assertObjectKeyBelongsTo } from "../common/storage/object-key";
import { assertOptionalAvailabilityRange } from "../common/date/calendar-date";

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
  hotelName: string;
  hotelCity: District;
  roomType: RoomType;
  pricePerNightMinor: number;
  currency: string;
  capacity: number;
  /**
   * Object key for the card image — the room's own photograph, or its hotel's,
   * or null.
   *
   * Nullable and expected to be null often: most listings will not have a
   * photograph on the day they are created. A card with no image falls back to
   * its painted tone, which is a finished state rather than a broken image, so
   * null needs no special handling beyond choosing the fallback.
   */
  coverObjectKey: string | null;
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
    if (owner.suspendedAt !== null) {
      throw new ForbiddenException("Your account is suspended");
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
      include: {
        // Active rooms only. This used to return every room, including ones a
        // vendor had deactivated — so the page offered rooms that could not be
        // booked, and the visitor found out after choosing one.
        //
        // Filtered in the query rather than after it, so there is no version of
        // this that fetches everything and forgets to filter on the way out.
        rooms: {
          where: { isActive: true },
          include: { photos: true },
        },
        photos: true,
      },
    });
    if (!hotel || !hotel.isActive) {
      throw new NotFoundException("Hotel not found");
    }
    return hotel as HotelDetailResult;
  }

  /**
   * Rooms in a district, and — when dates are given — only those free for them.
   *
   * Dates are optional so a visitor can look at a district before choosing when
   * to travel. With no dates this answers "what is here"; with dates, "what is
   * free". The overlap clause is added rather than the query being written
   * twice, so the two paths cannot drift apart on the parts that matter — the
   * active checks and the suspended-owner exclusion.
   */
  async searchAvailableRooms(
    checkIn?: string,
    checkOut?: string,
    city?: District,
  ): Promise<RoomAvailability[]> {
    const hasRange = assertOptionalAvailabilityRange(checkIn, checkOut);

    const cityFilter = city
      ? // The cast is load-bearing: without it Postgres cannot compare a text
        // parameter to the enum column, and the query fails at runtime rather
        // than at build time.
        Prisma.sql`AND h.city = ${city}::"District"`
      : Prisma.empty;

    const rangeFilter = hasRange
      ? Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.room_id = r.id
            AND b.status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
            AND b.date_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')
        )`
      : Prisma.empty;

    return this.prisma.$queryRaw<RoomAvailability[]>(Prisma.sql`
      SELECT r.id, r.hotel_id AS "hotelId", h.name AS "hotelName", h.city AS "hotelCity",
             r.room_type AS "roomType",
             r.price_per_night_minor AS "pricePerNightMinor", r.currency, r.capacity,
             -- The room's own photograph if it has one, otherwise the hotel's.
             -- Resolved here rather than in the browser: doing it client-side
             -- would cost a request per result, and a second round trip would
             -- make the page render twice.
             --
             -- LATERAL rather than a join, because a join to a one-to-many
             -- table multiplies the rows — a room with three photographs would
             -- appear three times in the results.
             COALESCE(rp.object_key, hp.object_key) AS "coverObjectKey"
      FROM rooms r
      JOIN hotels h ON h.id = r.hotel_id
      LEFT JOIN LATERAL (
        SELECT object_key FROM room_photos
        WHERE room_id = r.id
        -- Primary first, then oldest, so the choice is stable between calls.
        ORDER BY is_primary DESC, created_at ASC
        LIMIT 1
      ) rp ON true
      LEFT JOIN LATERAL (
        SELECT object_key FROM hotel_photos
        WHERE hotel_id = h.id
        ORDER BY is_primary DESC, created_at ASC
        LIMIT 1
      ) hp ON true
      WHERE r.is_active = true AND h.is_active = true ${cityFilter}
        AND h.owner_id NOT IN (SELECT id FROM users WHERE suspended_at IS NOT NULL)
        ${rangeFilter}
      ORDER BY r.price_per_night_minor ASC
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
    assertObjectKeyBelongsTo("hotels", hotelId, objectKey);
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
