import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./common/redis/redis.module";
import { CaslModule } from "./casl/casl.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";

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
    CaslModule,
    UsersModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
