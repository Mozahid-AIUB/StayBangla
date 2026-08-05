import { Test } from "@nestjs/testing";
import { AdminAnalyticsController } from "./admin-analytics.controller";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminAnalyticsController", () => {
  let controller: AdminAnalyticsController;
  let service: {
    revenueTrend: jest.Mock;
    bookingStatusBreakdown: jest.Mock;
    topVendors: jest.Mock;
    districtDistribution: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      revenueTrend: jest.fn(),
      bookingStatusBreakdown: jest.fn(),
      topVendors: jest.fn(),
      districtDistribution: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAnalyticsController],
      providers: [{ provide: AdminAnalyticsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminAnalyticsController);
  });

  it("revenueTrend() delegates with query params", async () => {
    service.revenueTrend.mockResolvedValue([]);
    await controller.revenueTrend({ period: "weekly" });
    expect(service.revenueTrend).toHaveBeenCalledWith({
      period: "weekly",
      from: undefined,
      to: undefined,
    });
  });

  it("bookingStatusBreakdown() delegates with no params", async () => {
    service.bookingStatusBreakdown.mockResolvedValue({});
    await controller.bookingStatusBreakdown();
    expect(service.bookingStatusBreakdown).toHaveBeenCalled();
  });

  it("topVendors() delegates with query params", async () => {
    service.topVendors.mockResolvedValue([]);
    await controller.topVendors({ limit: 5, metric: "bookings" });
    expect(service.topVendors).toHaveBeenCalledWith({
      limit: 5,
      metric: "bookings",
    });
  });

  it("districtDistribution() delegates with no params", async () => {
    service.districtDistribution.mockResolvedValue([]);
    await controller.districtDistribution();
    expect(service.districtDistribution).toHaveBeenCalled();
  });
});
