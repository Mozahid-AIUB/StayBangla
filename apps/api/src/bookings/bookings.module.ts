import { Module } from "@nestjs/common";
import { PaymentsModule } from "../common/payments/payments.module";
import { BookingsService } from "./bookings.service";
import { BookingsController } from "./bookings.controller";
import { PaymentsController } from "./payments.controller";
import { BookingMaintenanceService } from "./booking-maintenance.service";
import { BookingMaintenanceController } from "./booking-maintenance.controller";

/**
 * No BullMQ.
 *
 * Both queues that used to be registered here have become sweeps over the
 * database, driven by an external scheduler calling one endpoint. Two reasons,
 * and the second is the one that matters.
 *
 * A delayed job only fires while a worker is awake, and a repeatable job only
 * repeats while something is running, so these two tasks were pinning the
 * entire backend to a host that never sleeps — which no free tier offers.
 *
 * More seriously, the hold deadline lived in Redis. Redis is a cache: flush
 * it, restart it without persistence, or move hosts, and every outstanding
 * hold loses its expiry. Those rooms stay reserved forever, nothing revisits
 * them, and nobody is told. The deadline is now a column on the booking, where
 * it survives whatever happens to the cache.
 *
 * Redis itself stays in the application — OTP storage and rate limiting still
 * use it. It is only no longer the thing keeping bookings honest.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [
    BookingsController,
    PaymentsController,
    BookingMaintenanceController,
  ],
  providers: [BookingsService, BookingMaintenanceService],
  exports: [BookingsService, BookingMaintenanceService],
})
export class BookingsModule {}
