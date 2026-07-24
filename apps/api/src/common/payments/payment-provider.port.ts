export interface ChargeResult {
  success: boolean;
}

export abstract class PaymentProviderPort {
  abstract charge(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<ChargeResult>;
}
