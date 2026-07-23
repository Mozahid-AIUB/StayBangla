import { createHash, randomInt } from "node:crypto";
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
  }

  private tooManyRequests(message: string): HttpException {
    return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }

  private hashOtp(otp: string): string {
    return createHash("sha256")
      .update(otp + this.pepper)
      .digest("hex");
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
    await this.redis.del(`otp:attempts:${identifier}`);

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

    if (storedHash !== this.hashOtp(otp)) {
      await this.redis.incr(attemptsKey);
      throw new BadRequestException("Invalid OTP (invalid)");
    }

    await this.redis.del(smsKey);
    await this.redis.del(emailKey);
    await this.redis.del(attemptsKey);
    return true;
  }
}
