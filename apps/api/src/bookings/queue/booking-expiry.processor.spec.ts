import { BookingExpiryProcessor } from "./booking-expiry.processor";
import { PrismaService } from "../../prisma/prisma.service";

describe("BookingExpiryProcessor", () => {
  it("auto-cancels a booking that is still HELD, guarded by status in the UPDATE", async () => {
    const prisma = {
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const processor = new BookingExpiryProcessor(
      prisma as unknown as PrismaService,
    );

    await processor.process({ data: { bookingId: "booking-1" } } as never);

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "booking-1", status: "HELD" },
      data: { status: "AUTO_CANCELLED" },
    });
  });

  it("is a safe no-op when the booking was already confirmed/cancelled before the timer fired", async () => {
    const prisma = {
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const processor = new BookingExpiryProcessor(
      prisma as unknown as PrismaService,
    );

    await expect(
      processor.process({ data: { bookingId: "booking-1" } } as never),
    ).resolves.not.toThrow();
  });
});
