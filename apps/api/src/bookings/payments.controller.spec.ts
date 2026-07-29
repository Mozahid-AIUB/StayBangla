import { Test } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { BookingsService } from "./bookings.service";
import { PrismaService } from "../prisma/prisma.service";

describe("PaymentsController", () => {
  let controller: PaymentsController;
  let bookingsService: { confirmIfValid: jest.Mock };
  let prisma: { booking: { findUnique: jest.Mock } };

  beforeEach(async () => {
    bookingsService = { confirmIfValid: jest.fn() };
    prisma = { booking: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: BookingsService, useValue: bookingsService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    controller = moduleRef.get(PaymentsController);
  });

  it("looks up the booking by gatewayTranId and confirms via BookingsService", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      gatewayTranId: "tran-1",
    });

    await controller.handleIpn({
      tran_id: "tran-1",
      val_id: "val-123",
      status: "VALID",
    });

    expect(prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { gatewayTranId: "tran-1" },
    });
    expect(bookingsService.confirmIfValid).toHaveBeenCalledWith(
      "b1",
      "val-123",
    );
  });

  it("logs and does nothing (no throw) when tran_id matches no booking", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);

    await expect(
      controller.handleIpn({
        tran_id: "unknown",
        val_id: "val-123",
        status: "VALID",
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(bookingsService.confirmIfValid).not.toHaveBeenCalled();
  });

  it("does not throw even if confirmIfValid rejects internally (always ack SSLCommerz)", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      gatewayTranId: "tran-1",
    });
    bookingsService.confirmIfValid.mockRejectedValue(new Error("boom"));

    await expect(
      controller.handleIpn({
        tran_id: "tran-1",
        val_id: "val-123",
        status: "VALID",
      }),
    ).resolves.toEqual({ status: "ok" });
  });
});
