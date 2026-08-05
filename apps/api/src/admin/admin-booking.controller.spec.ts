import { Test } from "@nestjs/testing";
import { AdminBookingController } from "./admin-booking.controller";
import { AdminBookingService } from "./admin-booking.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminBookingController", () => {
  let controller: AdminBookingController;
  let service: { list: jest.Mock; forceCancel: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn(), forceCancel: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminBookingController],
      providers: [{ provide: AdminBookingService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminBookingController);
  });

  it("list() delegates to AdminBookingService.list with the query params", async () => {
    service.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });

    await controller.list({ status: "CONFIRMED", district: "DHAKA" });

    expect(service.list).toHaveBeenCalledWith({
      status: "CONFIRMED",
      district: "DHAKA",
      from: undefined,
      to: undefined,
      page: undefined,
      pageSize: undefined,
    });
  });

  it("forceCancel() delegates to AdminBookingService.forceCancel with the caller's id, booking id, and reason", async () => {
    await controller.forceCancel(
      { id: "admin1", roles: ["ADMIN"] },
      "booking1",
      { reason: "duplicate" },
    );

    expect(service.forceCancel).toHaveBeenCalledWith(
      "admin1",
      "booking1",
      "duplicate",
    );
  });
});
