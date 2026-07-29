export interface PaymentSession {
  gatewayUrl: string;
  tranId: string;
}

export interface ValidationResult {
  valid: boolean;
  amountMinor: number;
  currency: string;
  storeId: string | null;
  valId: string | null;
}

export abstract class PaymentProviderPort {
  abstract createSession(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<PaymentSession>;

  abstract validateTransaction(valId: string): Promise<ValidationResult>;

  abstract queryByTranId(tranId: string): Promise<ValidationResult>;
}
