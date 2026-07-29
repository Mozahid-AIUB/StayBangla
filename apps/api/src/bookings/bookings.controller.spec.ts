import { Test } from "@nestjs/testing";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("BookingsController", () => {
  let controller: BookingsController;
  let bookingsService: {
    createBooking: jest.Mock;
    initiatePayment: jest.Mock;
    getPaymentStatus: jest.Mock;
    checkout: jest.Mock;
    cancel: jest.Mock;
    createBlock: jest.Mock;
  };

  beforeEach(async () => {
    bookingsService = {
      createBooking: jest.fn(),
      initiatePayment: jest.fn(),
      getPaymentStatus: jest.fn(),
      checkout: jest.fn(),
      cancel: jest.fn(),
      createBlock: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [{ provide: BookingsService, useValue: bookingsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BookingsController);
  });

  it("create() passes the caller's id", async () => {
    bookingsService.createBooking.mockResolvedValue({ id: "b1" });
    const dto = {
      bookableType: "ROOM" as const,
      bookableId: "r1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
    };
    const result = await controller.create(
      { id: "u1", roles: ["TRAVELER"] },
      dto,
    );
    expect(bookingsService.createBooking).toHaveBeenCalledWith("u1", dto);
    expect(result).toEqual({ id: "b1" });
  });

  it("checkout() passes the caller's id", async () => {
    bookingsService.checkout.mockResolvedValue({
      id: "b1",
      status: "COMPLETED",
    });
    await controller.checkout({ id: "v1", roles: ["VENDOR"] }, "b1");
    expect(bookingsService.checkout).toHaveBeenCalledWith("v1", "b1");
  });

  describe("initiatePayment", () => {
    it("delegates to BookingsService.initiatePayment", async () => {
      bookingsService.initiatePayment.mockResolvedValue({
        gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      });
      const result = await controller.initiatePayment(
        { id: "u1", roles: ["TRAVELER"] },
        "b1",
      );
      expect(bookingsService.initiatePayment).toHaveBeenCalledWith("u1", "b1");
      expect(result).toEqual({
        gatewayUrl: "https://sandbox.sslcommerz.com/pay/xyz",
      });
    });
  });

  describe("getPaymentStatus", () => {
    it("delegates to BookingsService.getPaymentStatus", async () => {
      bookingsService.getPaymentStatus.mockResolvedValue({
        paymentStatus: "PAID",
        gatewayTranId: "tran-1",
      });
      const result = await controller.getPaymentStatus(
        { id: "u1", roles: ["TRAVELER"] },
        "b1",
      );
      expect(bookingsService.getPaymentStatus).toHaveBeenCalledWith("u1", "b1");
      expect(result).toEqual({
        paymentStatus: "PAID",
        gatewayTranId: "tran-1",
      });
    });
  });

  describe("cancel", () => {
    it("passes acknowledgeNoRefund through to BookingsService.cancel", async () => {
      bookingsService.cancel.mockResolvedValue({
        id: "b1",
        status: "CANCELLED",
      });
      await controller.cancel({ id: "u1", roles: ["TRAVELER"] }, "b1", {
        acknowledgeNoRefund: true,
      });
      expect(bookingsService.cancel).toHaveBeenCalledWith("u1", "b1", true);
    });

    it("passes undefined when acknowledgeNoRefund is not provided", async () => {
      bookingsService.cancel.mockResolvedValue({
        id: "b1",
        status: "CANCELLED",
      });
      await controller.cancel({ id: "u1", roles: ["TRAVELER"] }, "b1", {});
      expect(bookingsService.cancel).toHaveBeenCalledWith(
        "u1",
        "b1",
        undefined,
      );
    });
  });

  it("createBlock() passes the caller's id", async () => {
    bookingsService.createBlock.mockResolvedValue({
      id: "block-1",
      status: "BLOCKED",
    });
    const dto = {
      bookableType: "ROOM" as const,
      bookableId: "r1",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    };
    await controller.createBlock({ id: "v1", roles: ["VENDOR"] }, dto);
    expect(bookingsService.createBlock).toHaveBeenCalledWith("v1", dto);
  });
});
