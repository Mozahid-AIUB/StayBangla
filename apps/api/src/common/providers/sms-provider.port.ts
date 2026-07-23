export abstract class SmsProviderPort {
  abstract send(to: string, body: string): Promise<void>;
}
