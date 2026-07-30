import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  startOfDhakaDay,
  endOfDhakaDay,
  startOfDhakaMonth,
  endOfDhakaMonth,
} from "../common/date/dhaka-time";
import { BookingRecord } from "../bookings/bookings.types";

export interface DashboardSummary {
  monthlyIncomeMinor: number;
  upcomingCheckIns: number;
  activeListings: number;
  hotelOccupancyRatePct?: number;
  vehicleUtilizationRatePct?: number;
  todayCheckIns: number;
  todayCheckOuts: number;
  verificationStatusAlert: string | null;
}

export interface VendorListing {
  id: string;
  label: string;
  isActive: boolean;
  photoCount: number;
  earningsMinor: number;
  bookingCount: number;
}

export interface BookingsFilter {
  status?: string;
  roomId?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
}

export interface EarningsQuery {
  period?: "today" | "week" | "month";
  from?: string;
  to?: string;
}

export interface EarningsResult {
  online: number;
  offline: number;
  total: number;
  byListing: { id: string; amountMinor: number }[];
}

@Injectable()
export class VendorDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async computeOccupancyRatePct(
    resourceIdsColumn: "room_id" | "vehicle_id",
    resourceIds: string[],
    monthStart: Date,
    monthEnd: Date,
  ): Promise<number> {
    if (resourceIds.length === 0) return 0;

    const totalNightsAvailable =
      resourceIds.length *
      Math.round(
        (monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24),
      );

    // monthStart/monthEnd are already the correct UTC instants for Dhaka
    // midnight boundaries (computed by startOfDhakaMonth/endOfDhakaMonth).
    // Truncating them to ::date must not go through .toISOString() (which
    // truncates using the UTC calendar date — up to a day earlier than the
    // intended Dhaka calendar date) nor a bare ::date cast on the bound
    // timestamptz parameter (which truncates using Postgres's session/server
    // timezone, defaulting to UTC in this deployment — the same bug under a
    // different spelling). Explicitly converting at 'Asia/Dhaka' before the
    // ::date cast truncates against the correct calendar day regardless of
    // the database server's own timezone setting.
    const rows = await this.prisma.$queryRaw<
      { bookedNights: bigint }[]
    >(Prisma.sql`
      SELECT COALESCE(SUM(
        upper(date_range * daterange((${monthStart}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date, (${monthEnd}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date, '[)')) -
        lower(date_range * daterange((${monthStart}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date, (${monthEnd}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date, '[)'))
      ), 0) AS "bookedNights"
      FROM bookings
      WHERE ${Prisma.raw(resourceIdsColumn)} = ANY(${resourceIds})
        AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
        AND date_range && daterange((${monthStart}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date, (${monthEnd}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date, '[)')
    `);

    const bookedNights = Number(rows[0]?.bookedNights ?? 0);
    if (totalNightsAvailable === 0) return 0;
    return Math.round((bookedNights / totalNightsAvailable) * 100);
  }

  private async getVendor(vendorId: string) {
    const vendor = await this.prisma.user.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) throw new NotFoundException("Vendor not found");
    return vendor;
  }

  async getSummary(vendorId: string): Promise<DashboardSummary> {
    const vendor = await this.getVendor(vendorId);
    const now = new Date();
    const monthStart = startOfDhakaMonth(now);
    const monthEnd = endOfDhakaMonth(now);
    const dayStart = startOfDhakaDay(now);
    const dayEnd = endOfDhakaDay(now);

    const isHotel =
      vendor.vendorType === "HOTEL" || vendor.vendorType === "BOTH";

    const [rooms, vehicles] = await Promise.all([
      isHotel
        ? this.prisma.room.findMany({ where: { hotel: { ownerId: vendorId } } })
        : Promise.resolve([]),
      !isHotel
        ? this.prisma.vehicle.findMany({ where: { ownerId: vendorId } })
        : Promise.resolve([]),
    ]);
    const activeListings = isHotel
      ? rooms.filter((r) => r.isActive).length
      : vehicles.filter((v) => v.isActive).length;

    const onlineIncome = await this.prisma.ledgerEntry.aggregate({
      where: {
        type: "VENDOR_OWED",
        booking: { resourceOwnerId: vendorId },
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amountMinor: true },
    });
    const offlineIncome = await this.prisma.vendorLedgerEntry.aggregate({
      where: {
        vendorId,
        direction: "INCOME",
        deletedAt: null,
        entryDate: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amountMinor: true },
    });

    const upcomingCheckIns = await this.prisma.booking.count({
      where: {
        resourceOwnerId: vendorId,
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
    });

    // Booking.dateRange is `Unsupported("daterange")` — Prisma Client cannot
    // select it via findMany/findUnique at all (confirmed: every existing
    // read of checkIn/checkOut in this codebase, e.g. createBooking's
    // RETURNING clause and createBlock's, goes through $queryRaw with
    // lower(date_range)::text/upper(date_range)::text). todayCheckIns/
    // todayCheckOuts need real dates, so this counts directly in SQL rather
    // than fetching rows into JS and filtering — avoids ever attempting to
    // read dateRange through Prisma Client.
    const todayCounts = await this.prisma.$queryRaw<
      { checkIns: bigint; checkOuts: bigint }[]
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE lower(date_range) >= ${dayStart} AND lower(date_range) < ${dayEnd}) AS "checkIns",
        COUNT(*) FILTER (WHERE upper(date_range) >= ${dayStart} AND upper(date_range) < ${dayEnd}) AS "checkOuts"
      FROM bookings
      WHERE resource_owner_id = ${vendorId}
        AND status IN ('CONFIRMED', 'CHECKED_IN')
    `);
    const todayCheckIns = Number(todayCounts[0]?.checkIns ?? 0);
    const todayCheckOuts = Number(todayCounts[0]?.checkOuts ?? 0);

    const verificationStatusAlert =
      vendor.verifiedStatus === "VERIFIED"
        ? null
        : vendor.verifiedStatus === "PENDING"
          ? "Your account is pending verification"
          : "Your account was rejected — see your profile for details";

    const summary: DashboardSummary = {
      monthlyIncomeMinor:
        (onlineIncome._sum.amountMinor ?? 0) +
        (offlineIncome._sum.amountMinor ?? 0),
      upcomingCheckIns,
      activeListings,
      todayCheckIns,
      todayCheckOuts,
      verificationStatusAlert,
    };

    if (isHotel) {
      summary.hotelOccupancyRatePct = await this.computeOccupancyRatePct(
        "room_id",
        rooms.filter((r) => r.isActive).map((r) => r.id),
        monthStart,
        monthEnd,
      );
    } else {
      summary.vehicleUtilizationRatePct = await this.computeOccupancyRatePct(
        "vehicle_id",
        vehicles.filter((v) => v.isActive).map((v) => v.id),
        monthStart,
        monthEnd,
      );
    }

    return summary;
  }

  async getListings(vendorId: string): Promise<VendorListing[]> {
    const vendor = await this.getVendor(vendorId);
    const isHotel =
      vendor.vendorType === "HOTEL" || vendor.vendorType === "BOTH";

    if (isHotel) {
      const rooms = await this.prisma.room.findMany({
        where: { hotel: { ownerId: vendorId } },
        include: { photos: true },
      });
      return Promise.all(
        rooms.map(async (room) => {
          const bookingCount = await this.prisma.booking.count({
            where: { roomId: room.id },
          });
          const earnings = await this.prisma.ledgerEntry.findMany({
            where: { type: "VENDOR_OWED", booking: { roomId: room.id } },
          });
          const offlineEarnings = await this.prisma.vendorLedgerEntry.findMany({
            where: { roomId: room.id, direction: "INCOME", deletedAt: null },
          });
          const earningsMinor =
            earnings.reduce((sum, e) => sum + e.amountMinor, 0) +
            offlineEarnings.reduce((sum, e) => sum + e.amountMinor, 0);
          return {
            id: room.id,
            label: room.roomType,
            isActive: room.isActive,
            photoCount: room.photos.length,
            earningsMinor,
            bookingCount,
          };
        }),
      );
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: { ownerId: vendorId },
    });
    return Promise.all(
      vehicles.map(async (vehicle) => {
        const bookingCount = await this.prisma.booking.count({
          where: { vehicleId: vehicle.id },
        });
        const earnings = await this.prisma.ledgerEntry.findMany({
          where: { type: "VENDOR_OWED", booking: { vehicleId: vehicle.id } },
        });
        const offlineEarnings = await this.prisma.vendorLedgerEntry.findMany({
          where: {
            vehicleId: vehicle.id,
            direction: "INCOME",
            deletedAt: null,
          },
        });
        const earningsMinor =
          earnings.reduce((sum, e) => sum + e.amountMinor, 0) +
          offlineEarnings.reduce((sum, e) => sum + e.amountMinor, 0);
        return {
          id: vehicle.id,
          label: vehicle.category,
          isActive: vehicle.isActive,
          photoCount: 0,
          earningsMinor,
          bookingCount,
        };
      }),
    );
  }

  async getBookings(
    vendorId: string,
    filter: BookingsFilter,
  ): Promise<BookingRecord[]> {
    // Same reasoning as todayCheckIns/todayCheckOuts above: checkIn/checkOut
    // must come from lower(date_range)/upper(date_range) via raw SQL, since
    // Prisma Client cannot select the Unsupported("daterange") column at
    // all. This also gives the from/to filter a real implementation — a
    // plain Prisma `where` clause has no way to express "overlaps this
    // range" against a column it can't see.
    const statusFilter = filter.status
      ? Prisma.sql`AND status = ${filter.status}`
      : Prisma.empty;
    const roomFilter = filter.roomId
      ? Prisma.sql`AND room_id = ${filter.roomId}`
      : Prisma.empty;
    const vehicleFilter = filter.vehicleId
      ? Prisma.sql`AND vehicle_id = ${filter.vehicleId}`
      : Prisma.empty;
    const rangeFilter =
      filter.from && filter.to
        ? Prisma.sql`AND date_range && daterange(${filter.from}::date, ${filter.to}::date, '[)')`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<BookingRecord[]>(Prisma.sql`
      SELECT id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
             vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
             lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
             guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
             currency, status, payment_status AS "paymentStatus", source,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM bookings
      WHERE resource_owner_id = ${vendorId} ${statusFilter} ${roomFilter} ${vehicleFilter} ${rangeFilter}
      ORDER BY created_at DESC
    `);
    return rows;
  }

  async getEarnings(
    vendorId: string,
    query: EarningsQuery,
  ): Promise<EarningsResult> {
    if (query.period && (query.from || query.to)) {
      throw new BadRequestException(
        "period and from/to are mutually exclusive",
      );
    }

    const now = new Date();
    let gte: Date;
    let lt: Date;
    if (query.from && query.to) {
      gte = new Date(query.from);
      lt = new Date(query.to);
    } else {
      const period = query.period ?? "month";
      if (period === "today") {
        gte = startOfDhakaDay(now);
        lt = endOfDhakaDay(now);
      } else if (period === "week") {
        gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        lt = now;
      } else {
        gte = startOfDhakaMonth(now);
        lt = endOfDhakaMonth(now);
      }
    }

    const onlineEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        type: "VENDOR_OWED",
        booking: { resourceOwnerId: vendorId },
        createdAt: { gte, lt },
      },
      include: { booking: true },
    });
    const offlineEntries = await this.prisma.vendorLedgerEntry.findMany({
      where: {
        vendorId,
        direction: "INCOME",
        deletedAt: null,
        entryDate: { gte, lt },
      },
    });

    const online = onlineEntries.reduce((sum, e) => sum + e.amountMinor, 0);
    const offline = offlineEntries.reduce((sum, e) => sum + e.amountMinor, 0);

    const byListingMap = new Map<string, number>();
    for (const entry of onlineEntries) {
      const listingId = entry.booking.roomId ?? entry.booking.vehicleId;
      if (listingId) {
        byListingMap.set(
          listingId,
          (byListingMap.get(listingId) ?? 0) + entry.amountMinor,
        );
      }
    }
    for (const entry of offlineEntries) {
      const listingId = entry.roomId ?? entry.vehicleId;
      if (listingId) {
        byListingMap.set(
          listingId,
          (byListingMap.get(listingId) ?? 0) + entry.amountMinor,
        );
      }
    }

    return {
      online,
      offline,
      total: online + offline,
      byListing: Array.from(byListingMap.entries()).map(
        ([id, amountMinor]) => ({
          id,
          amountMinor,
        }),
      ),
    };
  }
}
