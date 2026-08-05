import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  startOfDhakaDay,
  startOfDhakaWeek,
  startOfDhakaMonth,
} from "../common/date/dhaka-time";

const ALL_BOOKING_STATUSES = [
  "HELD",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "AUTO_CANCELLED",
  "CANCELLED",
  "REFUNDED",
  "BLOCKED",
] as const;

export interface RevenueTrendPoint {
  bucketStart: string;
  grossMinor: number;
  platformFeeMinor: number;
  vendorOwedMinor: number;
}

export interface RevenueTrendFilter {
  period?: "daily" | "weekly" | "monthly";
  from?: string;
  to?: string;
}

export interface TopVendorRow {
  vendorId: string;
  vendorName: string | null;
  totalRevenueMinor: number;
  bookingCount: number;
}

export interface TopVendorsFilter {
  limit?: number;
  metric?: "revenue" | "bookings";
}

export interface DistrictDistributionRow {
  district: string;
  hotels: number;
  vehicles: number;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private bucketStartFor(
    date: Date,
    period: "daily" | "weekly" | "monthly",
  ): Date {
    if (period === "weekly") return startOfDhakaWeek(date);
    if (period === "monthly") return startOfDhakaMonth(date);
    return startOfDhakaDay(date);
  }

  async revenueTrend(filter: RevenueTrendFilter): Promise<RevenueTrendPoint[]> {
    const period = filter.period ?? "daily";
    const where: Record<string, unknown> = {};
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lt: new Date(filter.to) } : {}),
      };
    }

    // groupBy(["type", "createdAt"]) would group by the exact millisecond
    // timestamp — every row would form its own group, defeating bucketing
    // entirely. Instead, fetch matching rows and bucket them in JS with a
    // Map accumulator, the same pattern vendor-dashboard.service.ts's
    // getEarnings uses for its byListing aggregation.
    const entries = await this.prisma.ledgerEntry.findMany({
      where,
      select: { type: true, amountMinor: true, createdAt: true },
    });

    const buckets = new Map<string, RevenueTrendPoint>();
    for (const entry of entries) {
      const bucketStart = this.bucketStartFor(
        entry.createdAt,
        period,
      ).toISOString();
      const existing = buckets.get(bucketStart) ?? {
        bucketStart,
        grossMinor: 0,
        platformFeeMinor: 0,
        vendorOwedMinor: 0,
      };
      if (entry.type === "GROSS_PAYMENT")
        existing.grossMinor += entry.amountMinor;
      if (entry.type === "PLATFORM_FEE")
        existing.platformFeeMinor += entry.amountMinor;
      if (entry.type === "VENDOR_OWED")
        existing.vendorOwedMinor += entry.amountMinor;
      buckets.set(bucketStart, existing);
    }

    return Array.from(buckets.values()).sort((a, b) =>
      a.bucketStart.localeCompare(b.bucketStart),
    );
  }

  async bookingStatusBreakdown(): Promise<Record<string, number>> {
    const rows = await this.prisma.booking.groupBy({
      by: ["status"],
      _count: true,
    });

    const result: Record<string, number> = {};
    for (const status of ALL_BOOKING_STATUSES) {
      result[status] = 0;
    }
    for (const row of rows) {
      result[row.status] = typeof row._count === "number" ? row._count : 0;
    }
    return result;
  }

  async topVendors(filter: TopVendorsFilter): Promise<TopVendorRow[]> {
    const limit = filter.limit ?? 10;
    const metric = filter.metric ?? "revenue";

    const orderBy =
      metric === "bookings"
        ? Prisma.sql`"bookingCount" DESC`
        : Prisma.sql`"totalRevenueMinor" DESC`;

    return this.prisma.$queryRaw<TopVendorRow[]>(Prisma.sql`
      SELECT
        u.id AS "vendorId",
        u.full_name AS "vendorName",
        COALESCE(SUM(le.amount_minor) FILTER (WHERE le.type = 'GROSS_PAYMENT'), 0)::int AS "totalRevenueMinor",
        COUNT(DISTINCT b.id)::int AS "bookingCount"
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'VENDOR'
      LEFT JOIN bookings b ON b.resource_owner_id = u.id
      LEFT JOIN ledger_entries le ON le.booking_id = b.id
      GROUP BY u.id, u.full_name
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `);
  }

  async districtDistribution(): Promise<DistrictDistributionRow[]> {
    const [hotelRows, vehicleRows] = await Promise.all([
      this.prisma.hotel.groupBy({ by: ["city"], _count: true }),
      this.prisma.vehicle.groupBy({ by: ["city"], _count: true }),
    ]);

    const byDistrict = new Map<string, DistrictDistributionRow>();
    for (const row of hotelRows) {
      const count = typeof row._count === "number" ? row._count : 0;
      byDistrict.set(row.city, {
        district: row.city,
        hotels: count,
        vehicles: 0,
      });
    }
    for (const row of vehicleRows) {
      const count = typeof row._count === "number" ? row._count : 0;
      const existing = byDistrict.get(row.city) ?? {
        district: row.city,
        hotels: 0,
        vehicles: 0,
      };
      existing.vehicles = count;
      byDistrict.set(row.city, existing);
    }

    return Array.from(byDistrict.values());
  }
}
