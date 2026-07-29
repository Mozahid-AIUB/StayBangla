import { ConfigService } from "@nestjs/config";
import { SslcommerzPaymentProviderService } from "./sslcommerz-payment-provider.service";

function makeConfig(): ConfigService {
  const values: Record<string, string | boolean> = {
    SSLCOMMERZ_STORE_ID: "test-store",
    SSLCOMMERZ_STORE_PASSWORD: "test-password",
    SSLCOMMERZ_SANDBOX: true,
    FRONTEND_URL: "http://localhost:3000",
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("SslcommerzPaymentProviderService", () => {
  let service: SslcommerzPaymentProviderService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new SslcommerzPaymentProviderService(makeConfig());
  });

  describe("createSession", () => {
    it("posts to the sandbox session-init endpoint and returns the GatewayPageURL + tran_id", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "SUCCESS",
          GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/abc123",
        }),
      });

      const result = await service.createSession("booking-1", 500000, "BDT");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("sandbox.sslcommerz.com"),
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.gatewayUrl).toBe(
        "https://sandbox.sslcommerz.com/EasyCheckOut/abc123",
      );
      expect(result.tranId).toEqual(expect.any(String));
    });

    it("throws when SSLCommerz's session-init response has status !== SUCCESS", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "FAILED",
          failedreason: "Invalid store credentials",
        }),
      });

      await expect(
        service.createSession("booking-1", 500000, "BDT"),
      ).rejects.toThrow(/Invalid store credentials/);
    });

    it("sends amount as a decimal major-unit string, not minor units", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "SUCCESS",
          GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/abc123",
        }),
      });

      await service.createSession("booking-1", 500000, "BDT");

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = options.body as URLSearchParams;
      expect(body.get("total_amount")).toBe("5000.00");
    });
  });

  describe("validateTransaction", () => {
    it("calls the Order Validation API and returns a valid result on VALID status", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "VALID",
          amount: "5000.00",
          currency: "BDT",
          store_id: "test-store",
        }),
      });

      const result = await service.validateTransaction("val-id-123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("val_id=val-id-123"),
      );
      expect(result).toEqual({
        valid: true,
        amountMinor: 500000,
        currency: "BDT",
        storeId: "test-store",
        valId: "val-id-123",
      });
    });

    it("returns valid:false when SSLCommerz reports a non-VALID status", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "INVALID_TRANSACTION" }),
      });

      const result = await service.validateTransaction("val-id-123");

      expect(result.valid).toBe(false);
    });

    it("returns valid:false (not a thrown error) if the HTTP call itself fails", async () => {
      fetchMock.mockRejectedValue(new Error("network error"));

      const result = await service.validateTransaction("val-id-123");

      expect(result.valid).toBe(false);
    });
  });

  describe("queryByTranId", () => {
    it("calls the Transaction Query API and returns a valid result with val_id on VALID status", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "VALID",
          amount: "5000.00",
          currency: "BDT",
          store_id: "test-store",
          val_id: "val-id-456",
        }),
      });

      const result = await service.queryByTranId("tran-id-123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("tran_id=tran-id-123"),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("merchantTransIDvalidationAPI.php"),
      );
      expect(result).toEqual({
        valid: true,
        amountMinor: 500000,
        currency: "BDT",
        storeId: "test-store",
        valId: "val-id-456",
      });
    });

    it("returns valid:false when SSLCommerz reports a non-VALID status", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "INVALID_TRANSACTION" }),
      });

      const result = await service.queryByTranId("tran-id-123");

      expect(result.valid).toBe(false);
      expect(result.valId).toBeNull();
    });

    it("returns valid:false (not a thrown error) if the HTTP call itself fails", async () => {
      fetchMock.mockRejectedValue(new Error("network error"));

      const result = await service.queryByTranId("tran-id-123");

      expect(result.valid).toBe(false);
      expect(result.valId).toBeNull();
    });
  });
});
