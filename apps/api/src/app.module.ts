import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { LoggerModule } from "nestjs-pino";
import Redis from "ioredis";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./common/redis/redis.module";
import { CaslModule } from "./casl/casl.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { HotelsModule } from "./hotels/hotels.module";
import { VehiclesModule } from "./vehicles/vehicles.module";
import { BookingsModule } from "./bookings/bookings.module";
import { AdminModule } from "./admin/admin.module";

const isProduction = process.env.NODE_ENV === "production";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProduction ? "info" : "debug",
        transport: isProduction ? undefined : { target: "pino-pretty" },
        // Never log credentials/tokens even at debug level.
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
        ],
      },
    }),
    PrismaModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>("REDIS_URL") },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>("THROTTLE_TTL_SECONDS", 60) * 1000,
            limit: config.get<number>("THROTTLE_LIMIT", 100),
          },
        ],
        storage: new ThrottlerStorageRedisService(
          new Redis(config.get<string>("REDIS_URL", "redis://127.0.0.1:6380")),
        ),
      }),
    }),
    CaslModule,
    UsersModule,
    AuthModule,
    HealthModule,
    HotelsModule,
    VehiclesModule,
    BookingsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
