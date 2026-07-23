import { Logger } from "@nestjs/common";
import { ConsoleSmsProviderService } from "./console-sms-provider.service";

describe("ConsoleSmsProviderService", () => {
  it("logs the message instead of calling a real SMS gateway", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const service = new ConsoleSmsProviderService();

    await service.send("+8801700000000", "Your OTP is 123456");

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("+8801700000000"),
    );
    logSpy.mockRestore();
  });
});
