import { Test } from "@nestjs/testing";
import { OtpController } from "./otp.controller";
import { OtpService } from "./otp.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { ConfigService } from "@nestjs/config";
import { IdentifierThrottlerGuard } from "../common/throttler/identifier-throttler.guard";

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
    })
      // This unit spec exercises verify()'s business logic (account-type
      // rejection, roles derivation), not rate limiting — that has its own
      // dedicated e2e coverage in test/rate-limiting.e2e-spec.ts against the
      // real AppModule. IdentifierThrottlerGuard needs THROTTLER:MODULE_OPTIONS
      // / ThrottlerStorage providers this controller-only module doesn't wire.
      .overrideGuard(IdentifierThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
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
    expect(tokenService.issueTokenPair).toHaveBeenCalledWith({
      id: "u1",
      roles: ["TRAVELER"],
    });
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

  it("verify() creates a new TRAVELER user keyed by email when identifier contains '@'", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue(null);
    usersService.create.mockResolvedValue({
      id: "u2",
      email: "traveler@example.com",
      passwordHash: null,
    });
    tokenService.issueTokenPair.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
    });

    await controller.verify(
      { identifier: "traveler@example.com", otp: "123456" },
      res as never,
    );

    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "traveler@example.com",
        role: "TRAVELER",
      }),
    );
  });

  it("verify() reuses an existing pure-TRAVELER user instead of creating a duplicate", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue({
      id: "existing1",
      phone: "+8801700000000",
      passwordHash: null,
      roles: [{ role: "TRAVELER" }],
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
    expect(tokenService.issueTokenPair).toHaveBeenCalledWith({
      id: "existing1",
      roles: ["TRAVELER"],
    });
  });

  it("verify() rejects an existing TRAVELER account that also holds an additional role (GUIDE) rather than silently downgrading it to TRAVELER-only", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue({
      id: "multi1",
      email: "multi@example.com",
      passwordHash: null,
      roles: [{ role: "TRAVELER" }, { role: "GUIDE" }],
    });

    // Before the fix, this account would have been silently downgraded —
    // issued a token with roles: ["TRAVELER"] hardcoded, discarding the
    // GUIDE role entirely. The fix rejects any account holding a role other
    // than TRAVELER outright, matching the same "must not be reachable via
    // the passwordless flow" rule as a password-based account.
    await expect(
      controller.verify(
        { identifier: "multi@example.com", otp: "123456" },
        res as never,
      ),
    ).rejects.toThrow(/password login/i);

    expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
  });

  it("verify() derives roles from the user's actual roles rather than a hardcoded literal for a reused pure-TRAVELER account", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue({
      id: "pure1",
      email: "pure@example.com",
      passwordHash: null,
      roles: [{ role: "TRAVELER" }],
    });
    tokenService.issueTokenPair.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
    });

    await controller.verify(
      { identifier: "pure@example.com", otp: "123456" },
      res as never,
    );

    expect(tokenService.issueTokenPair).toHaveBeenCalledWith({
      id: "pure1",
      roles: ["TRAVELER"],
    });
  });

  it("verify() rejects an existing account with a passwordHash (password-based account), even if its only role is TRAVELER", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue({
      id: "pw1",
      email: "haspassword@example.com",
      passwordHash: "argon2id$...",
      roles: [{ role: "TRAVELER" }],
    });

    await expect(
      controller.verify(
        { identifier: "haspassword@example.com", otp: "123456" },
        res as never,
      ),
    ).rejects.toThrow(/password login/i);

    expect(usersService.create).not.toHaveBeenCalled();
    expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
  });

  it("verify() rejects an existing VENDOR account (no password required to fail the check — role alone is disqualifying)", async () => {
    otpService.verifyOtp.mockResolvedValue(true);
    usersService.findByIdentifier.mockResolvedValue({
      id: "vendor1",
      email: "vendor@example.com",
      passwordHash: "argon2id$...",
      roles: [{ role: "VENDOR" }],
    });

    await expect(
      controller.verify(
        { identifier: "vendor@example.com", otp: "123456" },
        res as never,
      ),
    ).rejects.toThrow(/password login/i);

    expect(usersService.create).not.toHaveBeenCalled();
    expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
  });
});
