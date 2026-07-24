import { Injectable, Logger } from "@nestjs/common";
import { ChargeResult, PaymentProviderPort } from "./payment-provider.port";

@Injectable()
export class StubPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(StubPaymentProviderService.name);

  async charge(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<ChargeResult> {
    this.logger.log(
      `[stub payment] booking=${bookingId} amount=${amountMinor} ${currency} -> success`,
    );
    return { success: true };
  }
}
