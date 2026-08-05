import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { startOfDhakaMonth, endOfDhakaMonth } from "../common/date/dhaka-time";

export interface PlatformOverview {
  totalVendors: number;
  totalTravelers: number;
  totalBookings: number;
  totalHotels: number;
  totalVehicles: number;
  activeSuspensions: number;
  monthlyRevenue: {
    grossMinor: number;
    platformFeeMinor: number;
    vendorOwedMinor: number;
  };
}

@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<PlatformOverview> {
    const now = new Date();
    const monthStart = startOfDhakaMonth(now);
    const monthEnd = endOfDhakaMonth(now);

    const [
      totalVendors,
      totalTravelers,
      totalBookings,
      totalHotels,
      totalVehicles,
      activeSuspensions,
      revenueByType,
    ] = await Promise.all([
      this.prisma.userRole.count({ where: { role: "VENDOR" } }),
      this.prisma.userRole.count({ where: { role: "TRAVELER" } }),
      this.prisma.booking.count(),
      this.prisma.hotel.count(),
      this.prisma.vehicle.count(),
      this.prisma.user.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.ledgerEntry.groupBy({
        by: ["type"],
        where: { createdAt: { gte: monthStart, lt: monthEnd } },
        _sum: { amountMinor: true },
      }),
    ]);

    const findSum = (type: string): number =>
      revenueByType.find((r) => r.type === type)?._sum.amountMinor ?? 0;

    return {
      totalVendors,
      totalTravelers,
      totalBookings,
      totalHotels,
      totalVehicles,
      activeSuspensions,
      monthlyRevenue: {
        grossMinor: findSum("GROSS_PAYMENT"),
        platformFeeMinor: findSum("PLATFORM_FEE"),
        vendorOwedMinor: findSum("VENDOR_OWED"),
      },
    };
  }
}
