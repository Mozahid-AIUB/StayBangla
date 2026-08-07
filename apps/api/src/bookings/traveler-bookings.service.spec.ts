import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TravelerBookingsService } from "./traveler-bookings.service";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    bookableType: "ROOM",
    checkIn: "2026-09-01",
    checkOut: "2026-09-03",
    guestCount: 2,
    totalAmountMinor: 350000,
    currency: "BDT",
    status: "CONFIRMED",
    paymentStatus: "PAID",
    holdExpiresAt: null,
    createdAt: new Date(),
    hotelName: "Sea Pearl",
    hotelCity: "COXS_BAZAR",
    roomType: "DELUXE",
    vehicleCategory: null,
    vehicleModel: null,
    vehicleCity: null,
    ...overrides,
  };
}

// The parameters Prisma.sql collected, in order. The ownership filter is the
// security-critical part of both queries, and it is a bound parameter rather
// than anything visible in the returned rows — a query that forgot it would
// still return plausible data in a unit test.
function boundValues(call: unknown[]): unknown[] {
  const sql = call[0] as { values?: unknown[] };
  return sql.values ?? [];
}

describe("TravelerBookingsService", () => {
  let prisma: { $queryRaw: jest.Mock };
  let service: TravelerBookingsService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    service = new TravelerBookingsService(prisma as unknown as PrismaService);
  });

  describe("listForTraveler", () => {
    it("filters by the caller's own id", async () => {
      prisma.$queryRaw.mockResolvedValue([makeRow()]);

      await service.listForTraveler("traveler-1");

      expect(boundValues(prisma.$queryRaw.mock.calls[0])).toContain(
        "traveler-1",
      );
    });

    it("returns an empty array rather than throwing when there are none", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.listForTraveler("traveler-1")).resolves.toEqual([]);
    });

    it("orders by check-in, newest first", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listForTraveler("traveler-1");

      const sql = prisma.$queryRaw.mock.calls[0][0] as { strings: string[] };
      expect(sql.strings.join(" ")).toMatch(
        /ORDER BY[\s\S]*checkIn[\s\S]*DESC/i,
      );
    });

    it("carries the hotel and room for a room booking", async () => {
      prisma.$queryRaw.mockResolvedValue([makeRow()]);

      const [row] = await service.listForTraveler("traveler-1");

      expect(row).toMatchObject({
        hotelName: "Sea Pearl",
        hotelCity: "COXS_BAZAR",
        roomType: "DELUXE",
      });
    });

    it("carries the vehicle for a vehicle booking", async () => {
      prisma.$queryRaw.mockResolvedValue([
        makeRow({
          bookableType: "VEHICLE",
          hotelName: null,
          hotelCity: null,
          roomType: null,
          vehicleCategory: "CAR",
          vehicleModel: "Toyota Noah",
          vehicleCity: "DHAKA",
        }),
      ]);

      const [row] = await service.listForTraveler("traveler-1");

      expect(row).toMatchObject({
        vehicleCategory: "CAR",
        vehicleModel: "Toyota Noah",
        vehicleCity: "DHAKA",
      });
    });
  });

  describe("findOwnedOrThrow", () => {
    it("returns the booking when the caller owns it", async () => {
      prisma.$queryRaw.mockResolvedValue([makeRow()]);

      await expect(
        service.findOwnedOrThrow("traveler-1", "b1"),
      ).resolves.toMatchObject({ id: "b1" });
    });

    it("binds both the booking id and the caller's id", async () => {
      prisma.$queryRaw.mockResolvedValue([makeRow()]);

      await service.findOwnedOrThrow("traveler-1", "b1");

      const values = boundValues(prisma.$queryRaw.mock.calls[0]);
      expect(values).toContain("traveler-1");
      expect(values).toContain("b1");
    });

    // 404 rather than 403 is deliberate. A 403 confirms the id exists, which
    // turns the endpoint into a way to enumerate other people's bookings.
    it("reports another traveller's booking as not found", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.findOwnedOrThrow("traveler-1", "someone-elses-booking"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reports an unknown id as not found, identically", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const missing = await service
        .findOwnedOrThrow("traveler-1", "no-such-booking")
        .catch((e: Error) => e.message);
      const notOwned = await service
        .findOwnedOrThrow("traveler-1", "someone-elses-booking")
        .catch((e: Error) => e.message);

      expect(missing).toBe(notOwned);
    });
  });
});
