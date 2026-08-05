import { ConfigService } from "@nestjs/config";
import { RedisService } from "../common/redis/redis.service";
import { SmsProviderPort } from "../common/providers/sms-provider.port";
import { EmailProviderPort } from "../common/providers/email-provider.port";
import { OtpService } from "./otp.service";

function makeConfig(): ConfigService {
  const values: Record<string, number | string> = {
    OTP_TTL_SECONDS: 300,
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_RATE_LIMIT_PER_IDENTIFIER_PER_HOUR: 5,
    OTP_RATE_LIMIT_PER_IP_PER_HOUR: 10,
    OTP_PEPPER: "test-pepper",
    OTP_ATTEMPTS_WINDOW_SECONDS: 3600,
  };
  return {
    get: (key: string, defaultValue?: number | string) =>
      values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

function makeRedisMock() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(
      async (key: string, value: string, _mode: string, _ttl: number) => {
        store.set(key, value);
        return "OK";
      },
    ),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => 1),
    exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    __store: store,
  };
}

describe("OtpService", () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let sms: { send: jest.Mock };
  let email: { send: jest.Mock };
  let service: OtpService;

  beforeEach(() => {
    redis = makeRedisMock();
    sms = { send: jest.fn().mockResolvedValue(undefined) };
    email = { send: jest.fn().mockResolvedValue(undefined) };
    service = new OtpService(
      makeConfig(),
      redis as unknown as RedisService,
      sms as unknown as SmsProviderPort,
      email as unknown as EmailProviderPort,
    );
  });

  describe("requestOtp", () => {
    it("stores a hashed OTP in redis with TTL and sends via the SMS provider", async () => {
      await service.requestOtp("sms", "+8801700000000");

      expect(redis.set).toHaveBeenCalledWith(
        "otp:sms:+8801700000000",
        expect.any(String),
        "EX",
        300,
      );
      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(email.send).not.toHaveBeenCalled();
    });

    it("sends via the email provider for channel=email", async () => {
      await service.requestOtp("email", "a@b.com");
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(sms.send).not.toHaveBeenCalled();
    });

    it("rejects a resend within the cooldown window", async () => {
      await service.requestOtp("sms", "+8801700000000");
      await expect(service.requestOtp("sms", "+8801700000000")).rejects.toThrow(
        /cooldown/i,
      );
    });

    it("rejects after exceeding the per-identifier hourly rate limit", async () => {
      for (let i = 0; i < 5; i += 1) {
        redis.__store.delete("otp:cooldown:+8801700000000");
        await service.requestOtp("sms", "+8801700000000");
      }
      redis.__store.delete("otp:cooldown:+8801700000000");
      await expect(service.requestOtp("sms", "+8801700000000")).rejects.toThrow(
        /rate limit/i,
      );
    });

    it("rejects after exceeding the per-IP hourly rate limit", async () => {
      for (let i = 0; i < 10; i += 1) {
        const identifier = `+880170000${String(i).padStart(4, "0")}`;
        await service.requestOtp("sms", identifier, "1.2.3.4");
      }
      await expect(
        service.requestOtp("sms", "+8801700009999", "1.2.3.4"),
      ).rejects.toThrow(/rate limit/i);
    });
  });

  describe("verifyOtp", () => {
    it("succeeds with the correct OTP and deletes the redis key (single use)", async () => {
      let sentOtp = "";
      sms.send.mockImplementation(async (_to: string, body: string) => {
        sentOtp = body.match(/\d{6}/)![0];
      });

      await service.requestOtp("sms", "+8801700000000");
      await expect(service.verifyOtp("+8801700000000", sentOtp)).resolves.toBe(
        true,
      );
      expect(redis.del).toHaveBeenCalledWith("otp:sms:+8801700000000");
    });

    it("rejects an incorrect OTP and increments the attempt counter", async () => {
      await service.requestOtp("sms", "+8801700000000");
      await expect(
        service.verifyOtp("+8801700000000", "000000"),
      ).rejects.toThrow(/invalid/i);
      expect(redis.incr).toHaveBeenCalledWith("otp:attempts:+8801700000000");
    });

    it("locks out after the max number of wrong attempts", async () => {
      await service.requestOtp("sms", "+8801700000000");
      for (let i = 0; i < 5; i += 1) {
        await service
          .verifyOtp("+8801700000000", "000000")
          .catch(() => undefined);
      }
      await expect(
        service.verifyOtp("+8801700000000", "000000"),
      ).rejects.toThrow(/locked/i);
    });

    it("throws a distinct error when the OTP has expired (no redis key found)", async () => {
      await expect(
        service.verifyOtp("+8801799999999", "123456"),
      ).rejects.toThrow(/expired/i);
    });

    it("does not reset the attempt counter when a new OTP is requested — the lockout survives a re-request", async () => {
      const identifier = "+8801700000000";

      await service.requestOtp("sms", identifier);
      for (let i = 0; i < 5; i += 1) {
        await service.verifyOtp(identifier, "000000").catch(() => undefined);
      }
      // At this point the identifier is locked out (5/5 wrong attempts).
      expect(redis.__store.get(`otp:attempts:${identifier}`)).toBe("5");

      // Attacker requests a fresh OTP, hoping to reset their own lockout.
      redis.__store.delete(`otp:cooldown:${identifier}`);
      await service.requestOtp("sms", identifier);

      // The attempt counter must still be there — requesting a new OTP must
      // not be a way to buy 5 more guesses.
      expect(redis.__store.get(`otp:attempts:${identifier}`)).toBe("5");
      await expect(service.verifyOtp(identifier, "000000")).rejects.toThrow(
        /locked/i,
      );
    });

    it("sets a TTL on the attempt counter the first time it is incremented, so the lockout eventually clears on its own", async () => {
      const identifier = "+8801700000001";
      await service.requestOtp("sms", identifier);

      await service.verifyOtp(identifier, "000000").catch(() => undefined);
      expect(redis.expire).toHaveBeenCalledWith(
        `otp:attempts:${identifier}`,
        3600,
      );

      redis.expire.mockClear();
      await service.verifyOtp(identifier, "000000").catch(() => undefined);
      // Only set once (on the first increment) — re-arming the TTL on every
      // failed attempt would let a slow-and-steady attacker keep the window
      // open indefinitely.
      expect(redis.expire).not.toHaveBeenCalledWith(
        `otp:attempts:${identifier}`,
        3600,
      );
    });
  });
});
