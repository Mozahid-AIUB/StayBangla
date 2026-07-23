import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule, JwtModuleOptions, JwtSignOptions } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ProvidersModule } from "../common/providers/providers.module";
import { UsersModule } from "../users/users.module";
import { PasswordService } from "./password.service";
import { OtpService } from "./otp.service";
import { OtpController } from "./otp.controller";
import { TokenService } from "./token.service";
import { CredentialsService } from "./credentials.service";
import { CredentialsController } from "./credentials.controller";
import { JwtAccessStrategy } from "./strategies/jwt-access.strategy";

@Module({
  imports: [
    ProvidersModule,
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>("JWT_ACCESS_SECRET"),
        signOptions: {
          expiresIn: config.get<string>(
            "JWT_ACCESS_EXPIRES_IN",
            "15m",
          ) as JwtSignOptions["expiresIn"],
        },
      }),
    }),
  ],
  controllers: [OtpController, CredentialsController],
  providers: [
    PasswordService,
    OtpService,
    TokenService,
    CredentialsService,
    JwtAccessStrategy,
  ],
  exports: [TokenService],
})
export class AuthModule {}
