import { Module } from "@nestjs/common";
import { SmsProviderPort } from "./sms-provider.port";
import { ConsoleSmsProviderService } from "./console-sms-provider.service";
import { EmailProviderPort } from "./email-provider.port";
import { ConsoleEmailProviderService } from "./console-email-provider.service";

@Module({
  providers: [
    { provide: SmsProviderPort, useClass: ConsoleSmsProviderService },
    { provide: EmailProviderPort, useClass: ConsoleEmailProviderService },
  ],
  exports: [SmsProviderPort, EmailProviderPort],
})
export class ProvidersModule {}
