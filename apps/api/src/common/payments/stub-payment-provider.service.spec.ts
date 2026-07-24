import { Logger } from "@nestjs/common";
import { StubPaymentProviderService } from "./stub-payment-provider.service";

describe("StubPaymentProviderService", () => {
  it("always resolves success and logs instead of calling a real gateway", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const service = new StubPaymentProviderService();

    const result = await service.charge("booking-1", 150000, "BDT");

    expect(result).toEqual({ success: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("booking-1"));
    logSpy.mockRestore();
  });
});
