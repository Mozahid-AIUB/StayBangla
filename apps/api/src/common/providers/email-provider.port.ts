export abstract class EmailProviderPort {
  abstract send(to: string, subject: string, body: string): Promise<void>;
}
