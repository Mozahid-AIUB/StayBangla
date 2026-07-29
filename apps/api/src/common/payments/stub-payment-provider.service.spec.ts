import { StubPaymentProviderService } from "./stub-payment-provider.service";

describe("StubPaymentProviderService", () => {
  let service: StubPaymentProviderService;

  beforeEach(() => {
    service = new StubPaymentProviderService();
  });

  it("createSession returns a fake gatewayUrl and a random tranId", async () => {
    const result = await service.createSession("booking-1", 500000, "BDT");
    expect(result.gatewayUrl).toEqual(expect.stringContaining("booking-1"));
    expect(result.tranId).toEqual(expect.any(String));
  });

  it("createSession generates a different tranId on each call", async () => {
    const first = await service.createSession("booking-1", 500000, "BDT");
    const second = await service.createSession("booking-2", 500000, "BDT");
    expect(first.tranId).not.toBe(second.tranId);
  });

  it("validateTransaction always returns a valid result", async () => {
    const result = await service.validateTransaction("fake-val-id");
    expect(result.valid).toBe(true);
  });

  it("validateTransaction echoes the input valId in the result", async () => {
    const result = await service.validateTransaction("fake-val-id");
    expect(result.valId).toBe("fake-val-id");
  });

  it("queryByTranId always returns a valid result with a derived valId", async () => {
    const result = await service.queryByTranId("fake-tran-id");
    expect(result.valid).toBe(true);
    expect(result.valId).toBe("stub-val-id-for-fake-tran-id");
  });
});
