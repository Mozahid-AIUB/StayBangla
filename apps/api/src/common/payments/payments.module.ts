import { Module } from "@nestjs/common";
import { PaymentProviderPort } from "./payment-provider.port";
import { SslcommerzPaymentProviderService } from "./sslcommerz-payment-provider.service";

@Module({
  providers: [
    {
      provide: PaymentProviderPort,
      useClass: SslcommerzPaymentProviderService,
    },
  ],
  exports: [PaymentProviderPort],
})
export class PaymentsModule {}
