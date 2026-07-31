import { PrismaService } from "../prisma/prisma.service";
import { AdminOverviewService } from "./admin-overview.service";

describe("AdminOverviewService", () => {
  let service: AdminOverviewService;
  let prisma: {
    userRole: { count: jest.Mock };
    booking: { count: jest.Mock };
    hotel: { count: jest.Mock };
    vehicle: { count: jest.Mock };
    user: { count: jest.Mock };
    ledgerEntry: { groupBy: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      userRole: { count: jest.fn() },
      booking: { count: jest.fn() },
      hotel: { count: jest.fn() },
      vehicle: { count: jest.fn() },
      user: { count: jest.fn() },
      ledgerEntry: { groupBy: jest.fn() },
    };
    service = new AdminOverviewService(prisma as unknown as PrismaService);
  });

  it("returns headline counts and Dhaka-month-scoped revenue broken out by ledger type", async () => {
    prisma.userRole.count.mockImplementation(
      async ({ where }: { where: { role: string } }) =>
        where.role === "VENDOR" ? 42 : 310,
    );
    prisma.booking.count.mockResolvedValue(128);
    prisma.hotel.count.mockResolvedValue(30);
    prisma.vehicle.count.mockResolvedValue(15);
    prisma.user.count.mockResolvedValue(2);
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      { type: "GROSS_PAYMENT", _sum: { amountMinor: 4500000 } },
      { type: "PLATFORM_FEE", _sum: { amountMinor: 450000 } },
      { type: "VENDOR_OWED", _sum: { amountMinor: 4050000 } },
    ]);

    const result = await service.getOverview();

    expect(result).toEqual({
      totalVendors: 42,
      totalTravelers: 310,
      totalBookings: 128,
      totalHotels: 30,
      totalVehicles: 15,
      activeSuspensions: 2,
      monthlyRevenue: {
        grossMinor: 4500000,
        platformFeeMinor: 450000,
        vendorOwedMinor: 4050000,
      },
    });
  });

  it("returns zero revenue fields when there are no ledger entries this month", async () => {
    prisma.userRole.count.mockResolvedValue(0);
    prisma.booking.count.mockResolvedValue(0);
    prisma.hotel.count.mockResolvedValue(0);
    prisma.vehicle.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    prisma.ledgerEntry.groupBy.mockResolvedValue([]);

    const result = await service.getOverview();

    expect(result.monthlyRevenue).toEqual({
      grossMinor: 0,
      platformFeeMinor: 0,
      vendorOwedMinor: 0,
    });
  });
});
