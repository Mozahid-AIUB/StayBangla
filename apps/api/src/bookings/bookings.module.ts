import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { PaymentsModule } from "../common/payments/payments.module";
import { BookingsService } from "./bookings.service";
import { BookingsController } from "./bookings.controller";
import { PaymentsController } from "./payments.controller";
import {
  BookingExpiryQueueService,
  BOOKING_EXPIRY_QUEUE,
} from "./queue/booking-expiry-queue.service";
import { BookingExpiryProcessor } from "./queue/booking-expiry.processor";

@Module({
  imports: [
    PaymentsModule,
    BullModule.registerQueue({ name: BOOKING_EXPIRY_QUEUE }),
  ],
  controllers: [BookingsController, PaymentsController],
  providers: [
    BookingsService,
    BookingExpiryQueueService,
    BookingExpiryProcessor,
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
