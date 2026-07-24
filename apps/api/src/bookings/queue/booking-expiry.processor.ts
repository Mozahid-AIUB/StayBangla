import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { BOOKING_EXPIRY_QUEUE } from "./booking-expiry-queue.service";

interface ExpireBookingJobData {
  bookingId: string;
}

@Processor(BOOKING_EXPIRY_QUEUE)
export class BookingExpiryProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ExpireBookingJobData>): Promise<void> {
    await this.prisma.booking.updateMany({
      where: { id: job.data.bookingId, status: "HELD" },
      data: { status: "AUTO_CANCELLED" },
    });
  }
}
