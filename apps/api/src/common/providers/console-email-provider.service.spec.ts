import { Logger } from "@nestjs/common";
import { ConsoleEmailProviderService } from "./console-email-provider.service";

describe("ConsoleEmailProviderService", () => {
  it("logs the message instead of calling a real email gateway", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const service = new ConsoleEmailProviderService();

    await service.send("to@example.com", "Subject", "Body");

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("to@example.com"),
    );
    logSpy.mockRestore();
  });
});
