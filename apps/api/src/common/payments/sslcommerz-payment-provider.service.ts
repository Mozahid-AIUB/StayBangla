import { randomUUID } from "node:crypto";
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PaymentProviderPort,
  PaymentSession,
  ValidationResult,
} from "./payment-provider.port";

interface SessionInitResponse {
  status: string;
  GatewayPageURL?: string;
  failedreason?: string;
}

interface ValidationApiResponse {
  status: string;
  amount?: string;
  currency?: string;
  store_id?: string;
}

interface TransactionQueryApiResponse extends ValidationApiResponse {
  val_id?: string;
}

@Injectable()
export class SslcommerzPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(SslcommerzPaymentProviderService.name);
  private readonly storeId: string;
  private readonly storePassword: string;
  private readonly baseUrl: string;
  private readonly frontendUrl: string;

  constructor(config: ConfigService) {
    this.storeId = config.get<string>("SSLCOMMERZ_STORE_ID", "");
    this.storePassword = config.get<string>("SSLCOMMERZ_STORE_PASSWORD", "");
    const sandbox = config.get<boolean>("SSLCOMMERZ_SANDBOX", true);
    this.baseUrl = sandbox
      ? "https://sandbox.sslcommerz.com"
      : "https://securepay.sslcommerz.com";
    this.frontendUrl = config.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
  }

  async createSession(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<PaymentSession> {
    const tranId = randomUUID();
    const amountMajor = (amountMinor / 100).toFixed(2);

    const body = new URLSearchParams({
      store_id: this.storeId,
      store_passwd: this.storePassword,
      total_amount: amountMajor,
      currency,
      tran_id: tranId,
      success_url: `${this.frontendUrl}/bookings/${bookingId}/payment-result?status=success`,
      fail_url: `${this.frontendUrl}/bookings/${bookingId}/payment-result?status=fail`,
      cancel_url: `${this.frontendUrl}/bookings/${bookingId}/payment-result?status=cancel`,
      ipn_url: `${this.frontendUrl}/payments/sslcommerz/ipn`,
      cus_name: "StayBangla Traveler",
      cus_email: "traveler@staybangla.example",
      cus_add1: "Dhaka",
      cus_phone: "01700000000",
      shipping_method: "NO",
      product_name: "StayBangla Booking",
      product_category: "Travel",
      product_profile: "general",
    });

    const response = await fetch(`${this.baseUrl}/gwprocess/v4/api.php`, {
      method: "POST",
      body,
    });
    const data = (await response.json()) as SessionInitResponse;

    if (data.status !== "SUCCESS" || !data.GatewayPageURL) {
      throw new InternalServerErrorException(
        `SSLCommerz session creation failed: ${data.failedreason ?? "unknown reason"}`,
      );
    }

    return { gatewayUrl: data.GatewayPageURL, tranId };
  }

  async validateTransaction(valId: string): Promise<ValidationResult> {
    try {
      const query = new URLSearchParams({
        val_id: valId,
        store_id: this.storeId,
        store_passwd: this.storePassword,
        format: "json",
      });
      const response = await fetch(
        `${this.baseUrl}/validator/api/validationserverAPI.php?${query.toString()}`,
      );
      const data = (await response.json()) as ValidationApiResponse;

      if (data.status !== "VALID" && data.status !== "VALIDATED") {
        return {
          valid: false,
          amountMinor: 0,
          currency: "",
          storeId: null,
          valId: null,
        };
      }

      const amountMinor = Math.round(parseFloat(data.amount ?? "0") * 100);
      return {
        valid: true,
        amountMinor,
        currency: data.currency ?? "",
        storeId: data.store_id ?? null,
        valId,
      };
    } catch (error) {
      this.logger.error(
        `SSLCommerz validation API call failed for valId=${valId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        valid: false,
        amountMinor: 0,
        currency: "",
        storeId: null,
        valId: null,
      };
    }
  }

  async queryByTranId(tranId: string): Promise<ValidationResult> {
    try {
      const query = new URLSearchParams({
        tran_id: tranId,
        store_id: this.storeId,
        store_passwd: this.storePassword,
        format: "json",
      });
      const response = await fetch(
        `${this.baseUrl}/validator/api/merchantTransIDvalidationAPI.php?${query.toString()}`,
      );
      const data = (await response.json()) as TransactionQueryApiResponse;

      if (data.status !== "VALID" && data.status !== "VALIDATED") {
        return {
          valid: false,
          amountMinor: 0,
          currency: "",
          storeId: null,
          valId: null,
        };
      }

      const amountMinor = Math.round(parseFloat(data.amount ?? "0") * 100);
      return {
        valid: true,
        amountMinor,
        currency: data.currency ?? "",
        storeId: data.store_id ?? null,
        valId: data.val_id ?? null,
      };
    } catch (error) {
      this.logger.error(
        `SSLCommerz transaction query API call failed for tranId=${tranId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        valid: false,
        amountMinor: 0,
        currency: "",
        storeId: null,
        valId: null,
      };
    }
  }
}
