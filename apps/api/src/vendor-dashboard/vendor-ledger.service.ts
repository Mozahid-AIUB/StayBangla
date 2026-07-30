import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  LedgerDirection,
  VendorLedgerCategory,
  VendorLedgerEntry,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateLedgerEntryInput {
  roomId?: string;
  vehicleId?: string;
  direction: LedgerDirection;
  category: Exclude<VendorLedgerCategory, "WALK_IN_BOOKING">;
  amountMinor: number;
  note?: string;
  entryDate: string;
}

@Injectable()
export class VendorLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    vendorId: string,
    input: CreateLedgerEntryInput,
  ): Promise<VendorLedgerEntry> {
    if ((input.category as string) === "WALK_IN_BOOKING") {
      throw new BadRequestException(
        "WALK_IN_BOOKING entries can only be created via POST /vendor/bookings/offline",
      );
    }

    const hasRoom = Boolean(input.roomId);
    const hasVehicle = Boolean(input.vehicleId);
    if (hasRoom === hasVehicle) {
      throw new BadRequestException(
        "Exactly one of roomId or vehicleId is required",
      );
    }

    if (hasRoom) {
      const room = await this.prisma.room.findUnique({
        where: { id: input.roomId },
        include: { hotel: true },
      });
      if (!room) throw new NotFoundException("Room not found");
      if (room.hotel.ownerId !== vendorId) {
        throw new ForbiddenException("You do not own this room");
      }
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: input.vehicleId },
      });
      if (!vehicle) throw new NotFoundException("Vehicle not found");
      if (vehicle.ownerId !== vendorId) {
        throw new ForbiddenException("You do not own this vehicle");
      }
    }

    return this.prisma.vendorLedgerEntry.create({
      data: {
        vendorId,
        roomId: input.roomId,
        vehicleId: input.vehicleId,
        bookingId: null,
        direction: input.direction,
        category: input.category,
        amountMinor: input.amountMinor,
        note: input.note,
        entryDate: new Date(input.entryDate),
      },
    });
  }

  async list(vendorId: string): Promise<VendorLedgerEntry[]> {
    return this.prisma.vendorLedgerEntry.findMany({
      where: { vendorId, deletedAt: null },
      orderBy: { entryDate: "desc" },
    });
  }

  async softDelete(vendorId: string, id: string): Promise<void> {
    const entry = await this.prisma.vendorLedgerEntry.findUnique({
      where: { id },
    });
    if (!entry) throw new NotFoundException("Ledger entry not found");
    if (entry.vendorId !== vendorId) {
      throw new ForbiddenException("You do not own this ledger entry");
    }
    await this.prisma.vendorLedgerEntry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
