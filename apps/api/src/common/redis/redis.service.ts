import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(configService: ConfigService) {
    super(configService.get<string>("REDIS_URL", "redis://127.0.0.1:6380"));
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
