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
  startOfDhakaWeek,
  endOfDhakaWeek,
  startOfDhakaMonth,
  endOfDhakaMonth,
} from "../common/date/dhaka-time";
import { BookingRecord } from "../bookings/bookings.types";

export interface DashboardSummary {
  monthlyIncomeMinor: number;
  /**
   * Count of CONFIRMED bookings whose check-in date is today (Asia/Dhaka)
   * or later. Excludes CHECKED_IN bookings — their check-in is by
   * definition already in the past, so they are not "upcoming".
   */
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

  // vendorType is nullable in the schema (VENDOR-role users mid-onboarding
  // haven't set it yet). Falling through to "not hotel" would silently
  // return a vehicle-shaped, all-zero response for someone with an
  // incomplete profile — indistinguishable from a real vehicle vendor with
  // zero vehicles. Rejecting explicitly surfaces the real state (onboarding
  // incomplete) instead of masking it as valid, empty data.
  private getVendorCapabilities(vendor: { vendorType: string | null }): {
    hasHotels: boolean;
    hasVehicles: boolean;
  } {
    if (!vendor.vendorType) {
      throw new BadRequestException(
        "Vendor profile is incomplete: vendorType is not set",
      );
    }
    return {
      hasHotels: vendor.vendorType === "HOTEL" || vendor.vendorType === "BOTH",
      hasVehicles:
        vendor.vendorType === "VEHICLE" || vendor.vendorType === "BOTH",
    };
  }

  async getSummary(vendorId: string): Promise<DashboardSummary> {
    const vendor = await this.getVendor(vendorId);
    const now = new Date();
    const monthStart = startOfDhakaMonth(now);
    const monthEnd = endOfDhakaMonth(now);
    const dayStart = startOfDhakaDay(now);
    const dayEnd = endOfDhakaDay(now);

    const { hasHotels, hasVehicles } = this.getVendorCapabilities(vendor);

    const [rooms, vehicles] = await Promise.all([
      hasHotels
        ? this.prisma.room.findMany({ where: { hotel: { ownerId: vendorId } } })
        : Promise.resolve([]),
      hasVehicles
        ? this.prisma.vehicle.findMany({ where: { ownerId: vendorId } })
        : Promise.resolve([]),
    ]);
    const activeListings =
      rooms.filter((r) => r.isActive).length +
      vehicles.filter((v) => v.isActive).length;

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

    // Booking.dateRange is `Unsupported("daterange")` — Prisma Client cannot
    // select it via findMany/findUnique at all (confirmed: every existing
    // read of checkIn/checkOut in this codebase, e.g. createBooking's
    // RETURNING clause and createBlock's, goes through $queryRaw with
    // lower(date_range)::text/upper(date_range)::text). todayCheckIns/
    // todayCheckOuts/upcomingCheckIns all need real dates, so this counts
    // directly in SQL rather than fetching rows into JS and filtering —
    // avoids ever attempting to read dateRange through Prisma Client.
    //
    // upcomingCheckIns: "upcoming" means the stay hasn't started yet, so
    // this counts CONFIRMED bookings whose check-in is today (Dhaka) or
    // later. Deliberately excludes CHECKED_IN — a CHECKED_IN booking's
    // check-in date is, by definition, already in the past, so it is not
    // "upcoming" under any reading of the word; it belongs in
    // todayCheckIns/todayCheckOuts (if today) or nowhere in this summary
    // (if further in the past). The previous implementation counted every
    // CONFIRMED/CHECKED_IN booking ever made, all-time, with no date bound
    // at all — a monotonically growing number mislabelled "upcoming".
    const counts = await this.prisma.$queryRaw<
      { upcomingCheckIns: bigint; checkIns: bigint; checkOuts: bigint }[]
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'CONFIRMED' AND lower(date_range) >= ${dayStart}) AS "upcomingCheckIns",
        COUNT(*) FILTER (WHERE lower(date_range) >= ${dayStart} AND lower(date_range) < ${dayEnd}) AS "checkIns",
        COUNT(*) FILTER (WHERE upper(date_range) >= ${dayStart} AND upper(date_range) < ${dayEnd}) AS "checkOuts"
      FROM bookings
      WHERE resource_owner_id = ${vendorId}
        AND status IN ('CONFIRMED', 'CHECKED_IN')
    `);
    const upcomingCheckIns = Number(counts[0]?.upcomingCheckIns ?? 0);
    const todayCheckIns = Number(counts[0]?.checkIns ?? 0);
    const todayCheckOuts = Number(counts[0]?.checkOuts ?? 0);

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

    // Both branches run independently for a BOTH vendor — populate both
    // rate fields rather than an if/else that only ever fills one. HOTEL-
    // only and VEHICLE-only vendors keep exactly today's behavior: hasHotels
    // and hasVehicles are mutually exclusive for them, so only the matching
    // field gets set and the other stays entirely absent from the response
    // (not present-and-0 — an unused side is not "idle", it doesn't exist).
    if (hasHotels) {
      summary.hotelOccupancyRatePct = await this.computeOccupancyRatePct(
        "room_id",
        rooms.filter((r) => r.isActive).map((r) => r.id),
        monthStart,
        monthEnd,
      );
    }
    if (hasVehicles) {
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
    const { hasHotels, hasVehicles } = this.getVendorCapabilities(vendor);

    const [roomListings, vehicleListings] = await Promise.all([
      hasHotels ? this.getRoomListings(vendorId) : Promise.resolve([]),
      hasVehicles ? this.getVehicleListings(vendorId) : Promise.resolve([]),
    ]);

    return [...roomListings, ...vehicleListings];
  }

  // Batched per-listing earnings/booking-count lookup shared by
  // getRoomListings/getVehicleListings, keyed by whichever column
  // ("room_id" | "vehicle_id") identifies the listing on bookings and
  // vendor_ledger_entries. Fixes the N+1 (3 awaited queries per listing,
  // ~3N round trips for an N-listing vendor) with 2 queries total,
  // regardless of N. Raw SQL rather than Prisma groupBy: LedgerEntry has no
  // room_id/vehicle_id column of its own (only booking_id, via a relation),
  // so grouping vendor earnings per listing needs a join — a Prisma groupBy
  // can't express that, but resource_owner_id = vendorId keeps this scoped
  // to the caller's own data same as every other raw query in this file.
  // bookingCount intentionally keeps its pre-existing behavior of counting
  // bookings in any status (not just real stays) — see the report for why
  // that is left as a separate, disclosed decision rather than folded into
  // this performance fix.
  private async getListingAggregates(
    vendorId: string,
    idColumn: "room_id" | "vehicle_id",
    listingIds: string[],
  ): Promise<Map<string, { earningsMinor: number; bookingCount: number }>> {
    if (listingIds.length === 0) return new Map();

    const [bookingRows, earningsRows] = await Promise.all([
      this.prisma.$queryRaw<{ listingId: string; bookingCount: bigint }[]>(
        Prisma.sql`
          SELECT ${Prisma.raw(idColumn)} AS "listingId", COUNT(*)::bigint AS "bookingCount"
          FROM bookings
          WHERE resource_owner_id = ${vendorId}
            AND ${Prisma.raw(idColumn)} = ANY(${listingIds})
          GROUP BY ${Prisma.raw(idColumn)}
        `,
      ),
      // amount_minor is Postgres int (int32); SUM() over it returns bigint
      // already, but the explicit ::bigint cast (and the Number() below)
      // match the codebase's established money-aggregate pattern (see
      // admin-analytics.service.ts) rather than relying on the implicit
      // widening — a single vendor's lifetime earnings across many
      // bookings can approach int32's ~2.15 crore BDT ceiling.
      this.prisma.$queryRaw<{ listingId: string; earningsMinor: bigint }[]>(
        Prisma.sql`
          SELECT listing_id AS "listingId", SUM(amount_minor)::bigint AS "earningsMinor"
          FROM (
            SELECT b.${Prisma.raw(idColumn)} AS listing_id, le.amount_minor
            FROM ledger_entries le
            JOIN bookings b ON b.id = le.booking_id
            WHERE b.resource_owner_id = ${vendorId}
              AND b.${Prisma.raw(idColumn)} = ANY(${listingIds})
              AND le.type = 'VENDOR_OWED'
            UNION ALL
            SELECT vle.${Prisma.raw(idColumn)} AS listing_id, vle.amount_minor
            FROM vendor_ledger_entries vle
            WHERE vle.vendor_id = ${vendorId}
              AND vle.${Prisma.raw(idColumn)} = ANY(${listingIds})
              AND vle.direction = 'INCOME'
              AND vle.deleted_at IS NULL
          ) combined
          GROUP BY listing_id
        `,
      ),
    ]);

    const result = new Map<
      string,
      { earningsMinor: number; bookingCount: number }
    >();
    for (const id of listingIds) {
      result.set(id, { earningsMinor: 0, bookingCount: 0 });
    }
    for (const row of bookingRows) {
      const entry = result.get(row.listingId);
      if (entry) entry.bookingCount = Number(row.bookingCount);
    }
    for (const row of earningsRows) {
      const entry = result.get(row.listingId);
      if (entry) entry.earningsMinor = Number(row.earningsMinor);
    }
    return result;
  }

  private async getRoomListings(vendorId: string): Promise<VendorListing[]> {
    const rooms = await this.prisma.room.findMany({
      where: { hotel: { ownerId: vendorId } },
      include: { photos: true },
    });
    if (rooms.length === 0) return [];

    const aggregates = await this.getListingAggregates(
      vendorId,
      "room_id",
      rooms.map((r) => r.id),
    );

    return rooms.map((room) => {
      const agg = aggregates.get(room.id) ?? {
        earningsMinor: 0,
        bookingCount: 0,
      };
      return {
        id: room.id,
        label: room.roomType,
        isActive: room.isActive,
        photoCount: room.photos.length,
        earningsMinor: agg.earningsMinor,
        bookingCount: agg.bookingCount,
      };
    });
  }

  private async getVehicleListings(vendorId: string): Promise<VendorListing[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { ownerId: vendorId },
    });
    if (vehicles.length === 0) return [];

    const aggregates = await this.getListingAggregates(
      vendorId,
      "vehicle_id",
      vehicles.map((v) => v.id),
    );

    return vehicles.map((vehicle) => {
      const agg = aggregates.get(vehicle.id) ?? {
        earningsMinor: 0,
        bookingCount: 0,
      };
      return {
        id: vehicle.id,
        label: vehicle.category,
        isActive: vehicle.isActive,
        photoCount: 0,
        earningsMinor: agg.earningsMinor,
        bookingCount: agg.bookingCount,
      };
    });
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
      ? Prisma.sql`AND status = ${filter.status}::"BookingStatus"`
      : Prisma.empty;
    const roomFilter = filter.roomId
      ? Prisma.sql`AND room_id = ${filter.roomId}`
      : Prisma.empty;
    const vehicleFilter = filter.vehicleId
      ? Prisma.sql`AND vehicle_id = ${filter.vehicleId}`
      : Prisma.empty;
    // One-sided from/to is supported rather than silently dropped: an
    // unbounded daterange endpoint (NULL on either side of daterange())
    // means "no bound on that side", so `from` alone filters everything
    // from that date forward and `to` alone filters everything up to (but
    // not including) that date — the natural half-open reading, matching
    // the '[)' bound used when both are given.
    const rangeFilter =
      filter.from || filter.to
        ? Prisma.sql`AND date_range && daterange(${filter.from ?? null}::date, ${filter.to ?? null}::date, '[)')`
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
      // new Date("2026-07-30") parses as 2026-07-30T00:00:00Z (UTC
      // midnight), but that Dhaka calendar day actually began six hours
      // earlier at 2026-07-29T18:00:00Z. Routing through startOfDhakaDay
      // truncates in Asia/Dhaka instead, matching the "today"/"month"
      // branches below and admin-analytics.service.ts's revenueTrend
      // filter. Keeps half-open [gte, lt) semantics: `to` is the start of
      // the Dhaka day *after* the last included day would be wrong here —
      // per the DTO/API contract `to` is itself the exclusive upper bound
      // day, consistent with getBookings' daterange '[)' filter.
      gte = startOfDhakaDay(new Date(query.from));
      lt = startOfDhakaDay(new Date(query.to));
    } else {
      const period = query.period ?? "month";
      if (period === "today") {
        gte = startOfDhakaDay(now);
        lt = endOfDhakaDay(now);
      } else if (period === "week") {
        gte = startOfDhakaWeek(now);
        lt = endOfDhakaWeek(now);
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
