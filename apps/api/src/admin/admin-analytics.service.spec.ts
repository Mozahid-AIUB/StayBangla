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
  });

  describe("revenueTrend", () => {
    it("buckets by month when period=monthly", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([]);

      const result = await service.revenueTrend({ period: "monthly" });

      expect(result).toEqual([]);
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
