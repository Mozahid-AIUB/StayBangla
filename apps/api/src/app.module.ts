import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./common/redis/redis.module";
import { RedisService } from "./common/redis/redis.service";
import { CaslModule } from "./casl/casl.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { HotelsModule } from "./hotels/hotels.module";
import { VehiclesModule } from "./vehicles/vehicles.module";
import { BookingsModule } from "./bookings/bookings.module";
import { AdminModule } from "./admin/admin.module";
import { VendorDashboardModule } from "./vendor-dashboard/vendor-dashboard.module";

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
    // BullMQ's root configuration is gone with the last queue that used it.
    // Booking expiry and payment reconciliation are now sweeps over the
    // database, run by an external scheduler, so nothing registers a queue and
    // this was configuration for a subsystem with no members.
    //
    // Redis stays — RedisModule above still backs OTP storage and the
    // throttler. What left is only the part that required a process to stay
    // awake waiting for a job to come due.
    //
    // The @nestjs/bullmq and bullmq packages are deliberately left in
    // package.json rather than pulled in the same change: an unused dependency
    // costs nothing at runtime, and removing it belongs with a lockfile change
    // that can be reviewed on its own.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => ({
        throttlers: [
          {
            ttl: config.get<number>("THROTTLE_TTL_SECONDS", 60) * 1000,
            limit: config.get<number>("THROTTLE_LIMIT", 100),
          },
        ],
        // Reuses the app's single lifecycle-managed RedisService connection
        // (RedisModule is @Global(), so it's injectable here without an
        // explicit import) instead of opening a second, unmanaged ioredis
        // client that would never be closed on shutdown.
        storage: new ThrottlerStorageRedisService(redis),
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
    VendorDashboardModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
