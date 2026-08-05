import { PrismaService } from "../prisma/prisma.service";
import { AdminAnalyticsService } from "./admin-analytics.service";

describe("AdminAnalyticsService", () => {
  let service: AdminAnalyticsService;
  let prisma: {
    ledgerEntry: { findMany: jest.Mock };
    booking: { groupBy: jest.Mock };
    $queryRaw: jest.Mock;
    hotel: { groupBy: jest.Mock };
    vehicle: { groupBy: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      ledgerEntry: { findMany: jest.fn() },
      booking: { groupBy: jest.fn() },
      $queryRaw: jest.fn(),
      hotel: { groupBy: jest.fn() },
      vehicle: { groupBy: jest.fn() },
    };
    service = new AdminAnalyticsService(prisma as unknown as PrismaService);
  });

  describe("bookingStatusBreakdown", () => {
    it("zero-fills every BookingStatus value not returned by groupBy", async () => {
      prisma.booking.groupBy.mockResolvedValue([
        { status: "CONFIRMED", _count: 5 },
        { status: "CANCELLED", _count: 2 },
      ]);

      const result = await service.bookingStatusBreakdown();

      expect(result).toEqual({
        HELD: 0,
        CONFIRMED: 5,
        CHECKED_IN: 0,
        COMPLETED: 0,
        AUTO_CANCELLED: 0,
        CANCELLED: 2,
        REFUNDED: 0,
        BLOCKED: 0,
      });
    });
  });

  describe("districtDistribution", () => {
    it("merges hotel and vehicle counts per district", async () => {
      prisma.hotel.groupBy.mockResolvedValue([{ city: "DHAKA", _count: 10 }]);
      prisma.vehicle.groupBy.mockResolvedValue([
        { city: "DHAKA", _count: 3 },
        { city: "SYLHET", _count: 4 },
      ]);

      const result = await service.districtDistribution();

      expect(result).toEqual(
        expect.arrayContaining([
          { district: "DHAKA", hotels: 10, vehicles: 3 },
          { district: "SYLHET", hotels: 0, vehicles: 4 },
        ]),
      );
    });

    it("filters both hotel and vehicle groupBy calls to isActive: true, matching the endpoint's 'active listings' contract", async () => {
      prisma.hotel.groupBy.mockResolvedValue([]);
      prisma.vehicle.groupBy.mockResolvedValue([]);

      await service.districtDistribution();

      expect(prisma.hotel.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(prisma.vehicle.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe("topVendors", () => {
    it("defaults to the revenue metric with limit 10", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.topVendors({});

      const [sqlObject] = prisma.$queryRaw.mock.calls[0];
      expect(sqlObject.values).toContain(10);
    });

    it("applies a caller-provided limit", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.topVendors({ limit: 5, metric: "bookings" });

      const [sqlObject] = prisma.$queryRaw.mock.calls[0];
      expect(sqlObject.values).toContain(5);
    });

    it("converts bigint totalRevenueMinor/bookingCount rows to plain JS numbers", async () => {
      // Postgres SUM(int)/COUNT(*) cast to ::bigint come back through
      // $queryRaw as native JS BigInt, which JSON.stringify cannot
      // serialize. The service must convert to Number before returning.
      prisma.$queryRaw.mockResolvedValue([
        {
          vendorId: "v1",
          vendorName: "Big Vendor",
          totalRevenueMinor: BigInt("3000000000"),
          bookingCount: BigInt(42),
        },
      ]);

      const result = await service.topVendors({});

      expect(result).toEqual([
        {
          vendorId: "v1",
          vendorName: "Big Vendor",
          totalRevenueMinor: 3000000000,
          bookingCount: 42,
        },
      ]);
      expect(typeof result[0]!.totalRevenueMinor).toBe("number");
      expect(typeof result[0]!.bookingCount).toBe("number");
      // Would fail against JSON.stringify if a raw BigInt ever leaked through.
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe("revenueTrend", () => {
    it("buckets by month when period=monthly", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([]);

      const result = await service.revenueTrend({ period: "monthly" });

      expect(result).toEqual([]);
    });

    it("actually calls startOfDhakaMonth for period=monthly: two entries in the same Dhaka month but different Dhaka days collapse into one bucket", async () => {
      // If bucketStartFor's monthly branch were never reached (e.g. swapped
      // with weekly, or period ignored entirely), these two different-day
      // entries would NOT collapse into a single bucket under daily/weekly
      // truncation — this fails unless the monthly branch actually runs.
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          type: "GROSS_PAYMENT",
          amountMinor: 4000,
          createdAt: new Date("2026-07-02T01:00:00Z"),
        },
        {
          type: "GROSS_PAYMENT",
          amountMinor: 6000,
          createdAt: new Date("2026-07-25T01:00:00Z"),
        },
      ]);

      const result = await service.revenueTrend({ period: "monthly" });

      expect(result).toHaveLength(1);
      expect(result[0]!.grossMinor).toBe(10000);
      // 2026-07-01T00:00 Dhaka == 2026-06-30T18:00:00Z
      expect(result[0]!.bucketStart).toBe("2026-06-30T18:00:00.000Z");
    });

    it("actually calls startOfDhakaWeek for period=weekly: two entries in the same Dhaka week but different Dhaka days collapse into one bucket, a third in the next week does not", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          // Monday 2026-07-27 Dhaka
          type: "GROSS_PAYMENT",
          amountMinor: 1000,
          createdAt: new Date("2026-07-27T01:00:00Z"),
        },
        {
          // Thursday 2026-07-30 Dhaka, same Dhaka week as above
          type: "GROSS_PAYMENT",
          amountMinor: 2000,
          createdAt: new Date("2026-07-30T10:00:00Z"),
        },
        {
          // Monday 2026-08-03 Dhaka, the FOLLOWING Dhaka week — must land in
          // a separate bucket, proving the branch discriminates by week
          // rather than always merging or always splitting.
          type: "GROSS_PAYMENT",
          amountMinor: 5000,
          createdAt: new Date("2026-08-03T01:00:00Z"),
        },
      ]);

      const result = await service.revenueTrend({ period: "weekly" });

      expect(result).toHaveLength(2);
      // Monday 2026-07-27 00:00 Dhaka == 2026-07-26T18:00:00Z
      expect(result[0]).toMatchObject({
        bucketStart: "2026-07-26T18:00:00.000Z",
        grossMinor: 3000,
      });
      // Monday 2026-08-03 00:00 Dhaka == 2026-08-02T18:00:00Z
      expect(result[1]).toMatchObject({
        bucketStart: "2026-08-02T18:00:00.000Z",
        grossMinor: 5000,
      });
    });

    it("routes from/to through startOfDhakaDay so the Prisma where-clause uses Dhaka-midnight boundaries, not raw UTC midnight", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([]);

      await service.revenueTrend({ from: "2026-07-30", to: "2026-07-31" });

      const [{ where }] = prisma.ledgerEntry.findMany.mock.calls[0];
      // A naive `new Date("2026-07-30")` is 2026-07-30T00:00:00.000Z — this
      // test fails if that UTC-truncated value is what reaches Prisma
      // instead of the Dhaka-truncated startOfDhakaDay result.
      expect((where.createdAt.gte as Date).toISOString()).toBe(
        "2026-07-29T18:00:00.000Z",
      );
      expect((where.createdAt.lt as Date).toISOString()).toBe(
        "2026-07-30T18:00:00.000Z",
      );
    });

    it("defaults to daily bucketing when no period is given, aggregating GROSS_PAYMENT/PLATFORM_FEE/VENDOR_OWED per bucket", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          type: "GROSS_PAYMENT",
          amountMinor: 10000,
          createdAt: new Date("2026-07-30T00:00:00Z"),
        },
        {
          type: "PLATFORM_FEE",
          amountMinor: 1000,
          createdAt: new Date("2026-07-30T01:00:00Z"),
        },
      ]);

      const result = await service.revenueTrend({});

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        grossMinor: 10000,
        platformFeeMinor: 1000,
        vendorOwedMinor: 0,
      });
      expect(result[0]).toHaveProperty("bucketStart");
    });

    it("groups two entries in the same Dhaka day into a single bucket", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          type: "GROSS_PAYMENT",
          amountMinor: 5000,
          createdAt: new Date("2026-07-30T01:00:00Z"),
        },
        {
          type: "GROSS_PAYMENT",
          amountMinor: 3000,
          createdAt: new Date("2026-07-30T15:00:00Z"),
        },
      ]);

      const result = await service.revenueTrend({});

      expect(result).toHaveLength(1);
      expect(result[0]!.grossMinor).toBe(8000);
    });
  });
});
