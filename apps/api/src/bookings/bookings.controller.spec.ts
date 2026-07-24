import { Test } from "@nestjs/testing";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("BookingsController", () => {
  let controller: BookingsController;
  let bookingsService: {
    createBooking: jest.Mock;
    confirmPayment: jest.Mock;
    checkout: jest.Mock;
    cancel: jest.Mock;
    createBlock: jest.Mock;
  };

  beforeEach(async () => {
    bookingsService = {
      createBooking: jest.fn(),
      confirmPayment: jest.fn(),
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

  it("confirmPayment() delegates by booking id", async () => {
    bookingsService.confirmPayment.mockResolvedValue({
      id: "b1",
      status: "CONFIRMED",
    });
    const result = await controller.confirmPayment("b1");
    expect(bookingsService.confirmPayment).toHaveBeenCalledWith("b1");
    expect(result.status).toBe("CONFIRMED");
  });

  it("checkout() passes the caller's id", async () => {
    bookingsService.checkout.mockResolvedValue({
      id: "b1",
      status: "COMPLETED",
    });
    await controller.checkout({ id: "v1", roles: ["VENDOR"] }, "b1");
    expect(bookingsService.checkout).toHaveBeenCalledWith("v1", "b1");
  });

  it("cancel() passes the caller's id", async () => {
    bookingsService.cancel.mockResolvedValue({ id: "b1", status: "CANCELLED" });
    await controller.cancel({ id: "u1", roles: ["TRAVELER"] }, "b1");
    expect(bookingsService.cancel).toHaveBeenCalledWith("u1", "b1");
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
