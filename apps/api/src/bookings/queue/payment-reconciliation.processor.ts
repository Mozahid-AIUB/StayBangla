import { Injectable, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { BookingsService } from "../bookings.service";
import { PaymentProviderPort } from "../../common/payments/payment-provider.port";
import { PAYMENT_RECONCILIATION_QUEUE } from "./payment-reconciliation-queue.service";

const RECONCILIATION_GRACE_PERIOD_MS = 60_000;

@Injectable()
@Processor(PAYMENT_RECONCILIATION_QUEUE)
export class PaymentReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly paymentProvider: PaymentProviderPort,
  ) {
    super();
  }

  async process(): Promise<void> {
    const staleBookings = await this.prisma.booking.findMany({
      where: {
        status: "HELD",
        paymentStatus: "PENDING",
        gatewayTranId: { not: null },
        createdAt: {
          lt: new Date(Date.now() - RECONCILIATION_GRACE_PERIOD_MS),
        },
      },
    });

    for (const booking of staleBookings) {
      if (!booking.gatewayTranId) continue;
      const result = await this.paymentProvider.queryByTranId(
        booking.gatewayTranId,
      );
      if (result.valid && result.valId) {
        this.logger.log(
          `Reconciliation confirming booking=${booking.id} tranId=${booking.gatewayTranId} (IPN likely lost)`,
        );
        await this.bookingsService.confirmIfValid(booking.id, result.valId);
      }
    }
  }
}
