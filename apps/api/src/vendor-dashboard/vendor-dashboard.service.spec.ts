import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorDashboardService } from "./vendor-dashboard.service";

function makePrismaMock() {
  return {
    user: { findUnique: jest.fn() },
    room: { findMany: jest.fn() },
    vehicle: { findMany: jest.fn() },
    booking: { count: jest.fn() },
    ledgerEntry: { aggregate: jest.fn(), findMany: jest.fn() },
    vendorLedgerEntry: { aggregate: jest.fn(), findMany: jest.fn() },
    // Booking.dateRange is Unsupported("daterange") — unselectable via
    // findMany/findUnique (see BookingsService.toBookingRecord's own
    // comment). todayCheckIns/todayCheckOuts and getBookings both read
    // checkIn/checkOut, so both go through $queryRaw, matching the only
    // pattern this codebase uses anywhere for reading booking dates.
    $queryRaw: jest.fn(),
  };
}

describe("VendorDashboardService", () => {
  let service: VendorDashboardService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new VendorDashboardService(prisma as unknown as PrismaService);
  });

  describe("getSummary", () => {
    it("returns hotelOccupancyRatePct (not vehicleUtilizationRatePct) for a HOTEL vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "VERIFIED",
      });
      prisma.room.findMany.mockResolvedValue([{ id: "room1", isActive: true }]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      expect(result).toHaveProperty("hotelOccupancyRatePct");
      expect(result).not.toHaveProperty("vehicleUtilizationRatePct");
    });

    it("returns vehicleUtilizationRatePct (not hotelOccupancyRatePct) for a VEHICLE vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "VEHICLE",
        verifiedStatus: "VERIFIED",
      });
      prisma.vehicle.findMany.mockResolvedValue([
        { id: "veh1", isActive: true },
      ]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      expect(result).toHaveProperty("vehicleUtilizationRatePct");
      expect(result).not.toHaveProperty("hotelOccupancyRatePct");
    });

    it("sums online (LedgerEntry VENDOR_OWED) and offline (VendorLedgerEntry INCOME) into monthlyIncomeMinor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "VERIFIED",
      });
      prisma.room.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: 8000 },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: 2000 },
      });

      const result = await service.getSummary("vendor1");

      expect(result.monthlyIncomeMinor).toBe(10000);
    });

    it("returns a non-null verificationStatusAlert when the vendor is not VERIFIED", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "PENDING",
      });
      prisma.room.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      expect(result.verificationStatusAlert).toMatch(/pending/i);
    });
  });

  describe("getListings", () => {
    it("returns rooms with photo count and per-room earnings for a HOTEL vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });
      prisma.room.findMany.mockResolvedValue([
        {
          id: "room1",
          roomType: "DOUBLE",
          isActive: true,
          photos: [{ id: "p1" }],
        },
      ]);
      // getRoomListings/getVehicleListings batch bookingCount + earnings
      // into two $queryRaw calls each (see getListingAggregates) instead of
      // per-listing Prisma calls — both return [] here (no bookings/
      // earnings), which getListingAggregates treats as "no rows -> 0".
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getListings("vendor1");

      expect(result[0]).toMatchObject({
        id: "room1",
        isActive: true,
        photoCount: 1,
        earningsMinor: 0,
        bookingCount: 0,
      });
    });
  });

  describe("getListings — BOTH vendorType", () => {
    it("returns both rooms and vehicles in one list for a BOTH vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "BOTH",
      });
      prisma.room.findMany.mockResolvedValue([
        {
          id: "room1",
          roomType: "DOUBLE",
          isActive: true,
          photos: [{ id: "p1" }],
        },
      ]);
      prisma.vehicle.findMany.mockResolvedValue([
        { id: "veh1", category: "JEEP", isActive: true },
      ]);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getListings("vendor1");

      const ids = result.map((r) => r.id);
      expect(ids).toContain("room1");
      expect(ids).toContain("veh1");
      expect(result).toHaveLength(2);
    });

    it("throws for a VENDOR-role user with a null vendorType instead of returning an empty vehicle-shaped list", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: null,
      });

      await expect(service.getListings("vendor1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("getBookings", () => {
    it("returns rows from $queryRaw with real checkIn/checkOut strings, not plain Prisma findMany", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: "booking1",
          userId: "traveler1",
          bookableType: "ROOM",
          roomId: "room1",
          vehicleId: null,
          resourceOwnerId: "vendor1",
          checkIn: "2026-08-01",
          checkOut: "2026-08-03",
          guestCount: 2,
          totalAmountMinor: 5000,
          currency: "BDT",
          status: "CONFIRMED",
          paymentStatus: "PAID",
          source: "ONLINE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getBookings("vendor1", {});

      expect(result[0]!.checkIn).toBe("2026-08-01");
      expect(result[0]!.checkOut).toBe("2026-08-03");
    });

    it("passes the roomId/status filter values into the query's SQL fragments", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getBookings("vendor1", {
        roomId: "room1",
        status: "CONFIRMED",
      });

      // Prisma.sql returns a real Prisma.Sql object (values embedded as
      // ${} interpolations) even with $queryRaw mocked — assert the
      // filter values reached the call at all, not the exact rendered
      // SQL string shape, since that's an implementation detail of how
      // Prisma.sql composes conditional Prisma.empty fragments.
      const [sqlObject] = prisma.$queryRaw.mock.calls[0];
      expect(sqlObject.values).toEqual(
        expect.arrayContaining(["vendor1", "CONFIRMED", "room1"]),
      );
    });
  });

  describe("getEarnings", () => {
    it("rejects when both period and from/to are given", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });

      await expect(
        service.getEarnings("vendor1", {
          period: "month",
          from: "2026-07-01",
          to: "2026-07-31",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("combines online and offline totals for the requested period", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });
      prisma.ledgerEntry.findMany.mockResolvedValue([
        { amountMinor: 3000, booking: { roomId: "room1", vehicleId: null } },
      ]);
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([
        {
          amountMinor: 1000,
          direction: "INCOME",
          roomId: "room1",
          vehicleId: null,
        },
      ]);

      const result = await service.getEarnings("vendor1", { period: "month" });

      expect(result.online).toBe(3000);
      expect(result.offline).toBe(1000);
      expect(result.total).toBe(4000);
    });

    it("parses from/to as Dhaka calendar days, not UTC midnight (DEFECT 4)", async () => {
      // new Date("2026-07-30") is 2026-07-30T00:00:00.000Z — six hours
      // after the real start of the Dhaka calendar day 2026-07-30, which
      // begins 2026-07-29T18:00:00.000Z. Asserting the exact gte/lt Date
      // instants passed to vendorLedgerEntry.findMany discriminates a
      // naive-UTC implementation (which would pass 2026-07-30T00:00:00Z)
      // from the Dhaka-aware one (2026-07-29T18:00:00Z).
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });
      prisma.ledgerEntry.findMany.mockResolvedValue([]);
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([]);

      await service.getEarnings("vendor1", {
        from: "2026-07-30",
        to: "2026-07-31",
      });

      const [{ where }] = prisma.vendorLedgerEntry.findMany.mock.calls[0];
      expect(where.entryDate.gte).toEqual(new Date("2026-07-29T18:00:00.000Z"));
      expect(where.entryDate.lt).toEqual(new Date("2026-07-30T18:00:00.000Z"));
    });

    it("period=week uses the Dhaka week boundary, not a rolling 168h UTC window (DEFECT 5)", async () => {
      // Fixed to the exact fixture from the review skill's own worked
      // example: Sunday 2026-08-02T19:00:00Z is Monday 2026-08-03 01:00 in
      // Dhaka (UTC+6) — already inside a NEW Dhaka week (Monday-anchored),
      // while in UTC terms it is still Sunday, the LAST day of the
      // previous week. A rolling-168h-UTC implementation computes
      // gte = now - 7d exactly; a Dhaka-week implementation computes
      // gte = the most recent Dhaka Monday 00:00, i.e.
      // 2026-08-03T00:00:00 Dhaka = 2026-08-02T18:00:00Z. These two are
      // different instants, so asserting the exact gte pins the fix and
      // fails against the unfixed rolling-window code.
      jest.useFakeTimers({ advanceTimers: false });
      jest.setSystemTime(new Date("2026-08-02T19:00:00.000Z"));
      try {
        prisma.user.findUnique.mockResolvedValue({
          id: "vendor1",
          vendorType: "HOTEL",
        });
        prisma.ledgerEntry.findMany.mockResolvedValue([]);
        prisma.vendorLedgerEntry.findMany.mockResolvedValue([]);

        await service.getEarnings("vendor1", { period: "week" });

        const [{ where }] = prisma.vendorLedgerEntry.findMany.mock.calls[0];
        expect(where.entryDate.gte).toEqual(
          new Date("2026-08-02T18:00:00.000Z"),
        );
        expect(where.entryDate.lt).toEqual(
          new Date("2026-08-09T18:00:00.000Z"),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("a lone `from` (no `to`) filters from that Dhaka day forward with no upper bound, instead of silently falling back to the current-month period (DEFECT 7)", async () => {
      // The unfixed code only special-cases `query.from && query.to` —
      // supplying just `from` falls through to the `else` branch and
      // silently returns the current-month window, discarding the caller's
      // filter with no error and no indication anything was ignored. This
      // asserts entryDate.lt is left unset (no upper bound) rather than
      // pinned to the current month's end, and entryDate.gte is the
      // Dhaka-day start of the supplied `from` — neither of which the
      // current-month fallback would produce.
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });
      prisma.ledgerEntry.findMany.mockResolvedValue([]);
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([]);

      await service.getEarnings("vendor1", { from: "2026-07-30" });

      const [{ where }] = prisma.vendorLedgerEntry.findMany.mock.calls[0];
      expect(where.entryDate.gte).toEqual(new Date("2026-07-29T18:00:00.000Z"));
      expect(where.entryDate.lt).toBeUndefined();
    });

    it("a lone `to` (no `from`) filters up to that Dhaka day with no lower bound, instead of silently falling back to the current-month period (DEFECT 7)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });
      prisma.ledgerEntry.findMany.mockResolvedValue([]);
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([]);

      await service.getEarnings("vendor1", { to: "2026-07-31" });

      const [{ where }] = prisma.vendorLedgerEntry.findMany.mock.calls[0];
      expect(where.entryDate.gte).toBeUndefined();
      expect(where.entryDate.lt).toEqual(new Date("2026-07-30T18:00:00.000Z"));
    });
  });

  describe("getSummary — BOTH vendorType", () => {
    it("sums rooms and vehicles into activeListings, and populates both rate fields, for a BOTH vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "BOTH",
        verifiedStatus: "VERIFIED",
      });
      prisma.room.findMany.mockResolvedValue([
        { id: "room1", isActive: true },
        { id: "room2", isActive: false },
      ]);
      prisma.vehicle.findMany.mockResolvedValue([
        { id: "veh1", isActive: true },
      ]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ checkIns: BigInt(0), checkOuts: BigInt(0) }])
        .mockResolvedValueOnce([{ bookedNights: BigInt(0) }])
        .mockResolvedValueOnce([{ bookedNights: BigInt(0) }]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      // 1 active room + 1 active vehicle = 2, not just one side.
      expect(result.activeListings).toBe(2);
      expect(result).toHaveProperty("hotelOccupancyRatePct");
      expect(result).toHaveProperty("vehicleUtilizationRatePct");
    });

    it("throws for a VENDOR-role user with a null (not-yet-onboarded) vendorType, rather than silently returning a vehicle-shaped empty response", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: null,
        verifiedStatus: "PENDING",
      });

      await expect(service.getSummary("vendor1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("getSummary — occupancy math", () => {
    it("computes hotelOccupancyRatePct as booked room-nights over available room-nights this month", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "VERIFIED",
      });
      prisma.room.findMany.mockResolvedValue([
        { id: "room1", isActive: true },
        { id: "room2", isActive: true },
      ]);
      prisma.booking.count.mockResolvedValue(0);
      // getSummary issues two separate $queryRaw calls: the today-counts
      // query first, then computeOccupancyRatePct's booked-nights query —
      // mockResolvedValueOnce in call order, not a single blanket mock,
      // since each call expects a different result shape.
      prisma.$queryRaw
        .mockResolvedValueOnce([{ checkIns: BigInt(0), checkOuts: BigInt(0) }])
        .mockResolvedValueOnce([{ bookedNights: BigInt(10) }]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      // 2 rooms * ~31 days (July) = 62 available room-nights; 10 booked -> ~16%
      expect(result.hotelOccupancyRatePct).toBeGreaterThan(0);
      expect(result.hotelOccupancyRatePct).toBeLessThanOrEqual(100);
    });

    it("returns 0 when the vendor has no active listings (avoids divide-by-zero)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "VERIFIED",
      });
      prisma.room.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([
        { checkIns: BigInt(0), checkOuts: BigInt(0) },
      ]);
      // No second $queryRaw call expected — computeOccupancyRatePct returns
      // 0 immediately when resourceIds is empty, without querying.
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      expect(result.hotelOccupancyRatePct).toBe(0);
    });
  });
});
