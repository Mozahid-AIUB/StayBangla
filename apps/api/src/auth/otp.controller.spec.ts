import { Test } from "@nestjs/testing";
import { OtpController } from "./otp.controller";
import { OtpService } from "./otp.service";

describe("OtpController", () => {
  let controller: OtpController;
  let otpService: { requestOtp: jest.Mock; verifyOtp: jest.Mock };

  beforeEach(async () => {
    otpService = { requestOtp: jest.fn(), verifyOtp: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [{ provide: OtpService, useValue: otpService }],
    }).compile();
    controller = moduleRef.get(OtpController);
  });

  it("request() delegates to OtpService.requestOtp", async () => {
    otpService.requestOtp.mockResolvedValue(undefined);
    const result = await controller.request(
      { channel: "sms", identifier: "+8801700000000" },
      "1.2.3.4",
    );
    expect(otpService.requestOtp).toHaveBeenCalledWith(
      "sms",
      "+8801700000000",
      "1.2.3.4",
    );
    expect(result.message).toBeDefined();
  });

  it("verify() delegates to OtpService.verifyOtp", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    await controller.verify({ identifier: "+8801700000000", otp: "123456" });
    expect(otpService.verifyOtp).toHaveBeenCalledWith(
      "+8801700000000",
      "123456",
    );
  });
});
