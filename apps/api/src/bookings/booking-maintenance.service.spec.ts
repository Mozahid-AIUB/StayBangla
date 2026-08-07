import { PrismaService } from "../prisma/prisma.service";
import { BookingMaintenanceService } from "./booking-maintenance.service";

/**
 * These replace two BullMQ processors, and the behaviour they replace was
 * money-adjacent: one cancels bookings, the other confirms paid ones. So the
 * assertions are about what the sweep must *not* do as much as what it must.
 */
describe("BookingMaintenanceService", () => {
  let prisma: {
    booking: { updateMany: jest.Mock; findMany: jest.Mock };
  };
  let bookingsService: { confirmIfValid: jest.Mock };
  let paymentProvider: { queryByTranId: jest.Mock };
  let service: BookingMaintenanceService;

  beforeEach(() => {
    prisma = {
      booking: { updateMany: jest.fn(), findMany: jest.fn() },
    };
    bookingsService = { confirmIfValid: jest.fn() };
    paymentProvider = { queryByTranId: jest.fn() };
    service = new BookingMaintenanceService(
      prisma as unknown as PrismaService,
      bookingsService as never,
      paymentProvider as never,
    );
  });

  describe("expireStaleHolds", () => {
    it("only touches HELD rows whose deadline has passed", async () => {
      prisma.booking.updateMany.mockResolvedValue({ count: 2 });
      const now = new Date("2026-08-07T10:00:00Z");

      await service.expireStaleHolds(now);

      // The whole safety argument is in this where clause, so it is asserted
      // exactly rather than by shape. Losing `status: HELD` would let the
      // sweep cancel confirmed, paid bookings; losing the deadline would
      // cancel every hold the moment it was created.
      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: {
          status: "HELD",
          holdExpiresAt: { not: null, lte: now },
        },
        data: { status: "AUTO_CANCELLED" },
      });
    });

    it("cancels to AUTO_CANCELLED, not CANCELLED", async () => {
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });

      await service.expireStaleHolds(new Date());

      // A traveller who walked away and one who cancelled on purpose are
      // different facts, and the admin views and analytics read this column to
      // tell them apart. The BullMQ processor this replaces used
      // AUTO_CANCELLED; changing it here would silently rewrite history.
      const call = prisma.booking.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe("AUTO_CANCELLED");
    });

    it("compares the deadline as a plain instant, with no timezone applied", async () => {
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });
      const now = new Date("2026-08-07T19:30:00Z");

      await service.expireStaleHolds(now);

      // 19:30Z is already the 8th in Dhaka. If anyone ever "fixes" this by
      // routing it through the Dhaka helpers — which is the right thing for
      // check-in dates and the wrong thing here — the value would shift by six
      // hours and holds would die early or linger. A hold is a stopwatch, not
      // a calendar day.
      const passed = prisma.booking.updateMany.mock.calls[0][0].where
        .holdExpiresAt.lte as Date;
      expect(passed.toISOString()).toBe("2026-08-07T19:30:00.000Z");
    });
  });

  describe("reconcileStalePayments", () => {
    const stale = (id: string, tranId: string | null) => ({
      id,
      gatewayTranId: tranId,
    });

    it("asks the gateway only about holds older than the grace period", async () => {
      prisma.booking.findMany.mockResolvedValue([]);
      const now = new Date("2026-08-07T10:00:00Z");

      await service.reconcileStalePayments(now);

      const where = prisma.booking.findMany.mock.calls[0][0].where;
      expect(where.status).toBe("HELD");
      expect(where.paymentStatus).toBe("PENDING");
      expect(where.gatewayTranId).toEqual({ not: null });
      // A minute of grace: below it the IPN is probably still in flight, and
      // querying would race the callback that is about to arrive.
      expect((where.createdAt.lt as Date).toISOString()).toBe(
        "2026-08-07T09:59:00.000Z",
      );
    });

    it("confirms a booking the gateway says was paid", async () => {
      prisma.booking.findMany.mockResolvedValue([stale("b1", "tran-1")]);
      paymentProvider.queryByTranId.mockResolvedValue({
        valid: true,
        valId: "val-1",
      });

      const result = await service.reconcileStalePayments(new Date());

      expect(bookingsService.confirmIfValid).toHaveBeenCalledWith(
        "b1",
        "val-1",
      );
      expect(result.reconciled).toBe(1);
    });

    it("leaves a booking alone when the gateway says it was not paid", async () => {
      prisma.booking.findMany.mockResolvedValue([stale("b1", "tran-1")]);
      paymentProvider.queryByTranId.mockResolvedValue({ valid: false });

      const result = await service.reconcileStalePayments(new Date());

      expect(bookingsService.confirmIfValid).not.toHaveBeenCalled();
      expect(result.reconciled).toBe(0);
    });

    it("keeps going after one transaction fails", async () => {
      prisma.booking.findMany.mockResolvedValue([
        stale("b1", "tran-1"),
        stale("b2", "tran-2"),
      ]);
      paymentProvider.queryByTranId
        .mockRejectedValueOnce(new Error("gateway timeout"))
        .mockResolvedValueOnce({ valid: true, valId: "val-2" });

      const result = await service.reconcileStalePayments(new Date());

      // One unreachable transaction must not strand every booking behind it.
      // Without the try/catch the loop throws on b1 and b2 is never asked
      // about — and b2 is somebody who has already paid.
      expect(bookingsService.confirmIfValid).toHaveBeenCalledWith(
        "b2",
        "val-2",
      );
      expect(result.reconciled).toBe(1);
      expect(result.checked).toBe(2);
    });

    it("caps how many rows one sweep will take", async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      await service.reconcileStalePayments(new Date());

      // After an outage the backlog is exactly when an uncapped sweep would
      // try to resolve everything at once, on the smallest instance, at the
      // worst moment. The remainder is picked up a minute later.
      const args = prisma.booking.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
      expect(args.orderBy).toEqual({ createdAt: "asc" });
    });
  });

  describe("runAll", () => {
    it("reconciles before expiring", async () => {
      const order: string[] = [];
      prisma.booking.findMany.mockImplementation(async () => {
        order.push("reconcile");
        return [];
      });
      prisma.booking.updateMany.mockImplementation(async () => {
        order.push("expire");
        return { count: 0 };
      });

      await service.runAll();

      // Order is the whole correctness argument. A payment that landed while
      // the callback was lost has to be confirmed before the expiry pass sees
      // that row — reversed, a sweep arriving a minute late cancels a booking
      // the traveller has already paid for, and the money is gone.
      expect(order).toEqual(["reconcile", "expire"]);
    });
  });
});
