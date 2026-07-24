import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";

export const BOOKING_EXPIRY_QUEUE = "booking-expiry";

@Injectable()
export class BookingExpiryQueueService {
  constructor(
    @InjectQueue(BOOKING_EXPIRY_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async scheduleExpiry(bookingId: string): Promise<void> {
    const holdMinutes = this.config.get<number>("BOOKING_HOLD_MINUTES", 15);
    await this.queue.add(
      "expire-booking",
      { bookingId },
      {
        jobId: bookingId,
        delay: holdMinutes * 60 * 1000,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async cancelExpiry(bookingId: string): Promise<void> {
    await this.queue.remove(bookingId);
  }
}
