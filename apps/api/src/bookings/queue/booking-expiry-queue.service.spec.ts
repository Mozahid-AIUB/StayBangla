import { ConfigService } from "@nestjs/config";
import { BookingExpiryQueueService } from "./booking-expiry-queue.service";

describe("BookingExpiryQueueService", () => {
  let queue: { add: jest.Mock; remove: jest.Mock };
  let config: ConfigService;
  let service: BookingExpiryQueueService;

  beforeEach(() => {
    queue = { add: jest.fn(), remove: jest.fn() };
    config = { get: () => 15 } as unknown as ConfigService;
    service = new BookingExpiryQueueService(queue as never, config);
  });

  it("scheduleExpiry enqueues a delayed job keyed by bookingId (idempotent jobId)", async () => {
    await service.scheduleExpiry("booking-1");
    expect(queue.add).toHaveBeenCalledWith(
      "expire-booking",
      { bookingId: "booking-1" },
      expect.objectContaining({ jobId: "booking-1", delay: 15 * 60 * 1000 }),
    );
  });

  it("cancelExpiry removes the job by its bookingId-derived jobId", async () => {
    await service.cancelExpiry("booking-1");
    expect(queue.remove).toHaveBeenCalledWith("booking-1");
  });
});
