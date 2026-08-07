import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentProviderPort } from "../common/payments/payment-provider.port";
import { BookingsService } from "./bookings.service";

/**
 * How long a payment gateway is given to send its callback before a booking is
 * considered worth chasing. Below this the IPN is probably still in flight and
 * querying would race it.
 */
const RECONCILIATION_GRACE_PERIOD_MS = 60_000;

/**
 * Cap on rows touched per sweep.
 *
 * A sweep with no ceiling is a sweep that, after an outage, tries to resolve
 * every booking that piled up in one transaction — and on a free tier that is
 * how the whole API falls over at the worst possible moment. Anything left
 * over is taken by the next run a minute later.
 */
const RECONCILIATION_BATCH = 50;

export interface SweepResult {
  expired: number;
  reconciled: number;
  checked: number;
}

/**
 * The two jobs that used to be BullMQ, doing the same work on a schedule the
 * caller owns.
 *
 * Why they moved. Both needed a process that never sleeps: a delayed job only
 * fires if a worker is awake to fire it, and a repeatable job only repeats
 * while something is running. No free hosting tier offers an always-awake
 * process, so the whole backend was pinned to a paid box by two background
 * tasks.
 *
 * The deeper problem was where the deadline lived. It was a Redis key. Redis is
 * a cache — flush it, restart it without persistence, migrate hosts, and every
 * outstanding hold loses its expiry. Those rooms stay reserved forever, no
 * process ever revisits them, and nothing reports it. The booking's own row is
 * the only honest place for the booking's own deadline.
 *
 * Reconciliation barely changed: it was already a sweep over stale rows, only
 * triggered by BullMQ's repeat instead of by a request.
 */
@Injectable()
export class BookingMaintenanceService {
  private readonly logger = new Logger(BookingMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly paymentProvider: PaymentProviderPort,
  ) {}

  /**
   * Releases holds whose deadline has passed.
   *
   * One guarded updateMany, not a read followed by writes. The `status: HELD`
   * predicate is what makes it safe to run concurrently with everything else:
   * a booking confirmed a millisecond ago no longer matches, so two sweeps
   * overlapping — or a sweep racing an IPN — cannot cancel a paid booking.
   *
   * `new Date()` is a UTC instant and the column is a UTC instant, so the
   * comparison needs no timezone at all. Applying Asia/Dhaka here would shift
   * every deadline six hours: holds would either die before the traveller
   * could pay, or keep a room locked for six hours after they walked away.
   */
  async expireStaleHolds(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.booking.updateMany({
      where: {
        status: "HELD",
        holdExpiresAt: { not: null, lte: now },
      },
      data: { status: "AUTO_CANCELLED" },
    });

    if (result.count > 0) {
      this.logger.log(`Released ${result.count} expired hold(s)`);
    }
    return result.count;
  }

  /**
   * Catches payments the gateway took but never told us about.
   *
   * A lost IPN leaves a booking HELD with the traveller's money gone — the
   * worst state in the system, because from their side they have paid and from
   * ours they have not. This asks the gateway directly about anything that has
   * been waiting longer than the grace period.
   *
   * Failures are logged and skipped rather than thrown: one unreachable
   * transaction must not stop the sweep from resolving the rest, and the next
   * run will try it again in a minute.
   */
  async reconcileStalePayments(now: Date = new Date()): Promise<{
    checked: number;
    reconciled: number;
  }> {
    const stale = await this.prisma.booking.findMany({
      where: {
        status: "HELD",
        paymentStatus: "PENDING",
        gatewayTranId: { not: null },
        createdAt: {
          lt: new Date(now.getTime() - RECONCILIATION_GRACE_PERIOD_MS),
        },
      },
      take: RECONCILIATION_BATCH,
      orderBy: { createdAt: "asc" },
    });

    let reconciled = 0;
    for (const booking of stale) {
      if (!booking.gatewayTranId) continue;
      try {
        const result = await this.paymentProvider.queryByTranId(
          booking.gatewayTranId,
        );
        if (result.valid && result.valId) {
          this.logger.log(
            `Reconciliation confirming booking=${booking.id} tranId=${booking.gatewayTranId} (IPN likely lost)`,
          );
          await this.bookingsService.confirmIfValid(booking.id, result.valId);
          reconciled += 1;
        }
      } catch (error) {
        this.logger.error(
          `Reconciliation failed for booking=${booking.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { checked: stale.length, reconciled };
  }

  /**
   * Both sweeps, in the order that matters.
   *
   * Reconciliation runs first. If a payment landed but the callback was lost,
   * that booking must be confirmed before the expiry pass looks at it —
   * reversed, a sweep arriving a minute late would cancel a booking the
   * traveller had already paid for.
   */
  async runAll(now: Date = new Date()): Promise<SweepResult> {
    const { checked, reconciled } = await this.reconcileStalePayments(now);
    const expired = await this.expireStaleHolds(now);
    return { expired, reconciled, checked };
  }
}
