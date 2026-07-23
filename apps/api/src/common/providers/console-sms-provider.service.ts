import { Injectable, Logger } from "@nestjs/common";
import { SmsProviderPort } from "./sms-provider.port";

@Injectable()
export class ConsoleSmsProviderService implements SmsProviderPort {
  private readonly logger = new Logger(ConsoleSmsProviderService.name);

  async send(to: string, body: string): Promise<void> {
    this.logger.log(`[fake SMS] to=${to} body="${body}"`);
  }
}
