import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  PaymentProviderPort,
  PaymentSession,
  ValidationResult,
} from "./payment-provider.port";

@Injectable()
export class StubPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(StubPaymentProviderService.name);

  async createSession(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<PaymentSession> {
    const tranId = randomUUID();
    this.logger.log(
      `[stub payment] createSession booking=${bookingId} amount=${amountMinor} ${currency} tranId=${tranId}`,
    );
    return {
      gatewayUrl: `https://stub-gateway.example.com/pay/${bookingId}`,
      tranId,
    };
  }

  async validateTransaction(valId: string): Promise<ValidationResult> {
    this.logger.log(
      `[stub payment] validateTransaction valId=${valId} -> valid`,
    );
    return {
      valid: true,
      amountMinor: 0,
      currency: "BDT",
      storeId: null,
    };
  }
}
