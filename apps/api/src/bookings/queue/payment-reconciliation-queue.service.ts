import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

export const PAYMENT_RECONCILIATION_QUEUE = "payment-reconciliation";
const RECONCILIATION_INTERVAL_MS = 2 * 60 * 1000;

@Injectable()
export class PaymentReconciliationQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(PAYMENT_RECONCILIATION_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Idempotent: BullMQ's repeatable-job scheduler keys on the job name +
    // repeat options, so re-registering the same schedule on every app
    // restart does not create duplicate scheduled runs.
    await this.queue.add(
      "reconcile",
      {},
      {
        repeat: { every: RECONCILIATION_INTERVAL_MS },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
