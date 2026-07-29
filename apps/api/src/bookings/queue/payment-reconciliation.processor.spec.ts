import { PrismaService } from "../../prisma/prisma.service";
import { BookingsService } from "../bookings.service";
import { PaymentProviderPort } from "../../common/payments/payment-provider.port";
import { PaymentReconciliationProcessor } from "./payment-reconciliation.processor";

describe("PaymentReconciliationProcessor", () => {
  let processor: PaymentReconciliationProcessor;
  let prisma: { booking: { findMany: jest.Mock } };
  let bookingsService: { confirmIfValid: jest.Mock };
  let paymentProvider: { queryByTranId: jest.Mock };

  beforeEach(() => {
    prisma = { booking: { findMany: jest.fn() } };
    bookingsService = { confirmIfValid: jest.fn() };
    paymentProvider = { queryByTranId: jest.fn() };
    processor = new PaymentReconciliationProcessor(
      prisma as unknown as PrismaService,
      bookingsService as unknown as BookingsService,
      paymentProvider as unknown as PaymentProviderPort,
    );
  });

  it("queries for HELD+PENDING bookings older than 1 minute with a gatewayTranId", async () => {
    prisma.booking.findMany.mockResolvedValue([]);

    await processor.process();

    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: {
        status: "HELD",
        paymentStatus: "PENDING",
        gatewayTranId: { not: null },
        createdAt: { lt: expect.any(Date) },
      },
    });
  });

  it("calls queryByTranId and confirmIfValid for each stale booking that SSLCommerz reports as paid", async () => {
    prisma.booking.findMany.mockResolvedValue([
      { id: "b1", gatewayTranId: "tran-1" },
      { id: "b2", gatewayTranId: "tran-2" },
    ]);
    paymentProvider.queryByTranId.mockResolvedValueOnce({
      valid: true,
      amountMinor: 500000,
      currency: "BDT",
      storeId: null,
      valId: "stub-val-id-for-tran-1",
    });
    paymentProvider.queryByTranId.mockResolvedValueOnce({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
      valId: null,
    });

    await processor.process();

    expect(bookingsService.confirmIfValid).toHaveBeenCalledTimes(1);
    expect(bookingsService.confirmIfValid).toHaveBeenCalledWith(
      "b1",
      expect.any(String),
    );
  });

  it("does not call confirmIfValid for a booking SSLCommerz reports as not valid", async () => {
    prisma.booking.findMany.mockResolvedValue([
      { id: "b1", gatewayTranId: "tran-1" },
    ]);
    paymentProvider.queryByTranId.mockResolvedValue({
      valid: false,
      amountMinor: 0,
      currency: "",
      storeId: null,
      valId: null,
    });

    await processor.process();

    expect(bookingsService.confirmIfValid).not.toHaveBeenCalled();
  });
});
