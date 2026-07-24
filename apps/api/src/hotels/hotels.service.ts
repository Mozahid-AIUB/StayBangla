import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Hotel } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

export interface CreateHotelInput {
  name: string;
  city: string;
  address: string;
  description?: string;
  amenities?: string[];
  starRating?: number;
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
}
