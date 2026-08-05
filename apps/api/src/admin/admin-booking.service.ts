import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AdminBookingFilter {
  status?: string;
  district?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminBookingRow {
  id: string;
  status: string;
  bookableType: string;
  bookableId: string;
  district: string | null;
  userId: string | null;
  checkIn: string;
  checkOut: string;
  totalAmountMinor: number;
  currency: string;
  paymentStatus: string;
}

export interface AdminBookingListResult {
  items: AdminBookingRow[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AdminBookingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: AdminBookingFilter): Promise<AdminBookingListResult> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;

    const statusFilter = filter.status
      ? Prisma.sql`AND b.status = ${filter.status}::"BookingStatus"`
      : Prisma.empty;
    const districtFilter = filter.district
      ? Prisma.sql`AND COALESCE(h.city, v.city) = ${filter.district}::"District"`
      : Prisma.empty;
    const fromFilter = filter.from
      ? Prisma.sql`AND lower(b.date_range) >= ${filter.from}::date`
      : Prisma.empty;
    const toFilter = filter.to
      ? Prisma.sql`AND upper(b.date_range) <= ${filter.to}::date`
      : Prisma.empty;

    const whereClause = Prisma.sql`
      FROM bookings b
      LEFT JOIN rooms r ON r.id = b.room_id
      LEFT JOIN hotels h ON h.id = r.hotel_id
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      WHERE 1 = 1 ${statusFilter} ${districtFilter} ${fromFilter} ${toFilter}
    `;

    const [countRows, items] = await Promise.all([
      this.prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT count(*)::text AS total ${whereClause}`,
      ),
      this.prisma.$queryRaw<AdminBookingRow[]>(Prisma.sql`
        SELECT
          b.id, b.status,
          b.bookable_type AS "bookableType",
          COALESCE(b.room_id, b.vehicle_id) AS "bookableId",
          COALESCE(h.city, v.city) AS district,
          b.user_id AS "userId",
          lower(b.date_range)::text AS "checkIn",
          upper(b.date_range)::text AS "checkOut",
          b.total_amount_minor AS "totalAmountMinor",
          b.currency,
          b.payment_status AS "paymentStatus"
        ${whereClause}
        ORDER BY b.created_at DESC
        OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
      `),
    ]);

    return {
      items,
      page,
      pageSize,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async forceCancel(
    adminId: string,
    bookingId: string,
    reason: string,
  ): Promise<void> {
    const result = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "Booking is not in a state that can be force-cancelled",
      );
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: bookingId,
        actorId: adminId,
        action: "BOOKING_FORCE_CANCELLED",
        reason,
      },
    });
  }
}
