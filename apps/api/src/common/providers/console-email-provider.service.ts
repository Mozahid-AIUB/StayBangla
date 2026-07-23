import { Injectable, Logger } from "@nestjs/common";
import { EmailProviderPort } from "./email-provider.port";

@Injectable()
export class ConsoleEmailProviderService implements EmailProviderPort {
  private readonly logger = new Logger(ConsoleEmailProviderService.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(
      `[fake email] to=${to} subject="${subject}" body="${body}"`,
    );
  }
}
