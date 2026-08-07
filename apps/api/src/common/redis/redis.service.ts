import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(configService: ConfigService) {
    super(configService.get<string>("REDIS_URL", "redis://127.0.0.1:6380"), {
      // Namespaces every key this app writes, so one Redis server can host
      // more than one application without their keys colliding. Both things
      // StayBangla stores are generic enough to collide by accident: OTP
      // codes under `otp:*`, and the throttler's per-client counters.
      //
      // ioredis rewrites keys for ordinary commands and for the keys of an
      // EVAL — which is what the throttler issues — so this one option covers
      // both. Verified against a live server rather than taken from the docs.
      //
      // Empty by default, and that default is load-bearing: the e2e helpers
      // reach into Redis directly and match on `otp:*`. A prefix applied
      // everywhere by default would stop those patterns matching, and the
      // cleanup between tests would silently do nothing.
      keyPrefix: configService.get<string>("REDIS_KEY_PREFIX", ""),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
