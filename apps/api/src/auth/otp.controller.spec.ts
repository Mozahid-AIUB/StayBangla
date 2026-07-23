import { Test } from "@nestjs/testing";
import { OtpController } from "./otp.controller";
import { OtpService } from "./otp.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { ConfigService } from "@nestjs/config";

describe("OtpController", () => {
  let controller: OtpController;
  let otpService: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let tokenService: { issueTokenPair: jest.Mock };
  let usersService: { findByIdentifier: jest.Mock; create: jest.Mock };
  let res: { cookie: jest.Mock };

  beforeEach(async () => {
    otpService = { requestOtp: jest.fn(), verifyOtp: jest.fn() };
    tokenService = { issueTokenPair: jest.fn() };
    usersService = { findByIdentifier: jest.fn(), create: jest.fn() };
    res = { cookie: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        { provide: OtpService, useValue: otpService },
        { provide: TokenService, useValue: tokenService },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: { get: () => "development" } },
      ],
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

  it("verify() creates a new TRAVELER user, issues tokens, and sets a refresh cookie", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue(null);
    usersService.create.mockResolvedValue({
      id: "u1",
      phone: "+8801700000000",
      passwordHash: null,
    });
    tokenService.issueTokenPair.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
    });

    const result = await controller.verify(
      { identifier: "+8801700000000", otp: "123456" },
      res as never,
    );

    expect(otpService.verifyOtp).toHaveBeenCalledWith(
      "+8801700000000",
      "123456",
    );
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+8801700000000", role: "TRAVELER" }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      "refreshToken",
      "rt",
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toEqual({
      accessToken: "at",
      user: expect.objectContaining({ id: "u1" }),
    });
    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("verify() reuses an existing user instead of creating a duplicate", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue({
      id: "existing1",
      phone: "+8801700000000",
      passwordHash: null,
    });
    tokenService.issueTokenPair.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
    });

    const result = await controller.verify(
      { identifier: "+8801700000000", otp: "123456" },
      res as never,
    );

    expect(usersService.create).not.toHaveBeenCalled();
    expect(result.user).toEqual(expect.objectContaining({ id: "existing1" }));
  });
});
