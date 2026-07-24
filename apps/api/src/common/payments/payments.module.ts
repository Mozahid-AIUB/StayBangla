import { Module } from "@nestjs/common";
import { PaymentProviderPort } from "./payment-provider.port";
import { StubPaymentProviderService } from "./stub-payment-provider.service";

@Module({
  providers: [
    { provide: PaymentProviderPort, useClass: StubPaymentProviderService },
  ],
  exports: [PaymentProviderPort],
})
export class PaymentsModule {}
