import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { SmsProviderPort } from "src/common/providers/sms-provider.port";
import { cleanDatabase } from "./helpers/test-db";
import { cleanOtpKeys, disconnectTestRedis } from "./helpers/test-redis";
import { createVerifiedVendor } from "./helpers/test-fixtures";

const testRedis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");

describe("Auth OTP security (e2e)", () => {
  let app: INestApplication;
  let fakeSms: { send: jest.Mock };

  beforeAll(async () => {
    fakeSms = { send: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SmsProviderPort)
      .useValue(fakeSms)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await cleanDatabase();
    await cleanOtpKeys();
    await disconnectTestRedis();
    await testRedis.quit();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await cleanOtpKeys();
    fakeSms.send.mockClear();
  });

  async function requestAndCaptureOtp(identifier: string): Promise<string> {
    await request(app.getHttpServer())
      .post("/v1/auth/otp/request")
      .send({ channel: "sms", identifier });
    const body = fakeSms.send.mock.calls.at(-1)?.[1] as string;
    return /\d{6}/.exec(body)![0];
  }

  // CRITICAL 1: a password-based (VENDOR/GUIDE/ADMIN/SUPER_ADMIN) account
  // must not be reachable via the passwordless OTP flow, even with a
  // correct OTP for that identifier.
  it("refuses to issue a token for an existing VENDOR identifier, even with the correct OTP", async () => {
    const vendorEmail = "otp-security-vendor1@example.com";
    await createVerifiedVendor(app, vendorEmail);

    const otp = await requestAndCaptureOtp(vendorEmail);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ identifier: vendorEmail, otp });

    expect(verify.status).toBe(403);
    expect(verify.body.accessToken).toBeUndefined();
  });

  it("still allows a brand-new (never-seen) identifier to complete OTP verify and receive a TRAVELER token", async () => {
    const identifier = "+8801700005001";
    const otp = await requestAndCaptureOtp(identifier);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ identifier, otp });

    expect(verify.status).toBe(201);
    expect(verify.body.accessToken).toEqual(expect.any(String));
  });

  // CRITICAL 2(b): the per-identifier attempt lockout must survive a
  // re-request — requesting a fresh OTP must not reset the attacker's own
  // guess counter.
  it("keeps an identifier locked out after 5 wrong attempts even after a new OTP is requested", async () => {
    const identifier = "+8801700005002";
    await requestAndCaptureOtp(identifier);

    for (let i = 0; i < 5; i += 1) {
      const attempt = await request(app.getHttpServer())
        .post("/v1/auth/otp/verify")
        .send({ identifier, otp: "000000" });
      expect(attempt.status).toBe(400);
    }

    // Attacker requests a brand-new OTP, hoping to reset the attempt count.
    // Clear the resend cooldown directly (as rate-limiting.e2e-spec.ts does)
    // so this re-request itself isn't blocked by the unrelated 60s cooldown
    // — the thing under test is the attempts counter, not the cooldown.
    await testRedis.del(`otp:cooldown:${identifier}`);
    const freshOtp = await requestAndCaptureOtp(identifier);

    // Even with the CORRECT new OTP, the identifier is still locked out —
    // proves the lockout is keyed by identifier over a window, not by the
    // specific OTP value.
    const lockedOut = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ identifier, otp: freshOtp });
    expect(lockedOut.status).toBe(401);
    expect(lockedOut.body.message).toMatch(/locked/i);
  });
});
