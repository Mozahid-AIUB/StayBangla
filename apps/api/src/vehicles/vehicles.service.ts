import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Vehicle, District } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

export interface CreateVehicleInput {
  category: "CNG" | "JEEP" | "BOAT";
  city: District;
  model?: string;
  capacity: number;
  pricePerDayMinor: number;
}

export interface UpdateVehicleInput {
  pricePerDayMinor?: number;
  isActive?: boolean;
}

export interface VehicleAvailability {
  id: string;
  category: string;
  city: District;
  model: string | null;
  capacity: number;
  pricePerDayMinor: number;
  currency: string;
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async create(ownerId: string, input: CreateVehicleInput): Promise<Vehicle> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner || owner.verifiedStatus !== "VERIFIED") {
      throw new ForbiddenException("Only verified vendors can create listings");
    }
    if (owner.suspendedAt !== null) {
      throw new ForbiddenException("Your account is suspended");
    }
    return this.prisma.vehicle.create({ data: { ownerId, ...input } });
  }

  async findByIdOrThrow(id: string): Promise<Vehicle> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle || !vehicle.isActive) {
      throw new NotFoundException("Vehicle not found");
    }
    return vehicle;
  }

  async update(
    callerId: string,
    vehicleId: string,
    input: UpdateVehicleInput,
  ): Promise<Vehicle> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    if (vehicle.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this vehicle");
    }
    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: input,
    });
  }

  async searchAvailable(
    startDate: string,
    endDate: string,
    city?: District,
  ): Promise<VehicleAvailability[]> {
    const cityFilter = city
      ? Prisma.sql`AND v.city = ${city}::"District"`
      : Prisma.empty;
    return this.prisma.$queryRaw<VehicleAvailability[]>(Prisma.sql`
      SELECT v.id, v.category, v.city, v.model, v.capacity,
             v.price_per_day_minor AS "pricePerDayMinor", v.currency
      FROM vehicles v
      WHERE v.is_active = true ${cityFilter}
        AND v.owner_id NOT IN (SELECT id FROM users WHERE suspended_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.vehicle_id = v.id
            AND b.status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
            AND b.date_range && daterange(${startDate}::date, ${endDate}::date, '[)')
        )
    `);
  }
}
