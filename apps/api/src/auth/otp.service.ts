import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../common/redis/redis.service";
import { SmsProviderPort } from "../common/providers/sms-provider.port";
import { EmailProviderPort } from "../common/providers/email-provider.port";

type OtpChannel = "sms" | "email";

@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;
  private readonly rateLimitPerIdentifierPerHour: number;
  private readonly rateLimitPerIpPerHour: number;
  private readonly pepper: string;
  private readonly attemptsWindowSeconds: number;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
    private readonly smsProvider: SmsProviderPort,
    private readonly emailProvider: EmailProviderPort,
  ) {
    this.ttlSeconds = config.get<number>("OTP_TTL_SECONDS", 300);
    this.maxAttempts = config.get<number>("OTP_MAX_ATTEMPTS", 5);
    this.resendCooldownSeconds = config.get<number>(
      "OTP_RESEND_COOLDOWN_SECONDS",
      60,
    );
    this.rateLimitPerIdentifierPerHour = config.get<number>(
      "OTP_RATE_LIMIT_PER_IDENTIFIER_PER_HOUR",
      5,
    );
    this.rateLimitPerIpPerHour = config.get<number>(
      "OTP_RATE_LIMIT_PER_IP_PER_HOUR",
      10,
    );
    this.pepper = config.get<string>("OTP_PEPPER", "");
    // Bounds total wrong guesses per identifier over a rolling window rather
    // than per-OTP: the counter is no longer cleared on re-request (see
    // requestOtp below), so this TTL is what eventually gives an attacker a
    // fresh set of attempts, not asking for a new code. One hour matches the
    // identifier-level OTP request rate limit's own window.
    this.attemptsWindowSeconds = config.get<number>(
      "OTP_ATTEMPTS_WINDOW_SECONDS",
      3600,
    );
  }

  private tooManyRequests(message: string): HttpException {
    return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }

  private hashOtp(otp: string): string {
    return createHash("sha256")
      .update(otp + this.pepper)
      .digest("hex");
  }

  /**
   * Constant-time comparison of two equal-length hex digests. Both sides are
   * peppered SHA-256 digests the attacker cannot steer (unlike comparing a
   * raw OTP), so this is defence in depth rather than closing an exploitable
   * timing channel today — but `!==` on hex strings short-circuits on the
   * first differing character, which is the wrong habit to leave in place
   * next to genuinely secret material.
   */
  private hashesMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  private generateOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }

  async requestOtp(
    channel: OtpChannel,
    identifier: string,
    ip?: string,
  ): Promise<void> {
    const cooldownKey = `otp:cooldown:${identifier}`;
    if (await this.redis.exists(cooldownKey)) {
      throw this.tooManyRequests(
        "Please wait before requesting another OTP (cooldown)",
      );
    }

    const idRateKey = `otp:ratelimit:id:${identifier}`;
    const idCount = await this.redis.incr(idRateKey);
    if (idCount === 1) await this.redis.expire(idRateKey, 3600);
    if (idCount > this.rateLimitPerIdentifierPerHour) {
      throw this.tooManyRequests(
        "Too many OTP requests for this identifier (rate limit)",
      );
    }

    if (ip) {
      const ipRateKey = `otp:ratelimit:ip:${ip}`;
      const ipCount = await this.redis.incr(ipRateKey);
      if (ipCount === 1) await this.redis.expire(ipRateKey, 3600);
      if (ipCount > this.rateLimitPerIpPerHour) {
        throw this.tooManyRequests(
          "Too many OTP requests from this IP (rate limit)",
        );
      }
    }

    const otp = this.generateOtp();
    await this.redis.set(
      `otp:${channel}:${identifier}`,
      this.hashOtp(otp),
      "EX",
      this.ttlSeconds,
    );
    await this.redis.set(cooldownKey, "1", "EX", this.resendCooldownSeconds);
    // Deliberately NOT resetting otp:attempts:${identifier} here. It used to
    // be deleted on every new OTP issue, which let an attacker who hit the
    // 5-attempt cap simply request a fresh OTP to reset their own lockout —
    // the cap must bound total guesses per identifier over a window, not
    // per-OTP. The counter now gets its own TTL (see below) so it survives
    // across re-requests within that window and only expires on its own.

    if (channel === "sms") {
      await this.smsProvider.send(identifier, `Your StayBangla OTP is ${otp}`);
    } else {
      await this.emailProvider.send(
        identifier,
        "Your StayBangla OTP",
        `Your OTP is ${otp}`,
      );
    }
  }

  async verifyOtp(identifier: string, otp: string): Promise<boolean> {
    const attemptsKey = `otp:attempts:${identifier}`;
    const attempts = Number((await this.redis.get(attemptsKey)) ?? "0");
    if (attempts >= this.maxAttempts) {
      throw new UnauthorizedException(
        "Too many failed attempts, this OTP is locked (locked)",
      );
    }

    const smsKey = `otp:sms:${identifier}`;
    const emailKey = `otp:email:${identifier}`;
    const storedHash =
      (await this.redis.get(smsKey)) ?? (await this.redis.get(emailKey));

    if (!storedHash) {
      throw new GoneException(
        "OTP has expired, please request a new one (expired)",
      );
    }

    if (!this.hashesMatch(storedHash, this.hashOtp(otp))) {
      const nextAttempts = await this.redis.incr(attemptsKey);
      if (nextAttempts === 1) {
        await this.redis.expire(attemptsKey, this.attemptsWindowSeconds);
      }
      throw new BadRequestException("Invalid OTP (invalid)");
    }

    await this.redis.del(smsKey);
    await this.redis.del(emailKey);
    await this.redis.del(attemptsKey);
    return true;
  }
}
