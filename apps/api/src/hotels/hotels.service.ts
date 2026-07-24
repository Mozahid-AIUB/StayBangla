import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Hotel,
  Prisma,
  District,
  FacilityCatalog,
  RoomType,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

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

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
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
}
