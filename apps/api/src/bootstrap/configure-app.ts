import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { parseCorsOrigins } from "./parse-cors-origins";

// Shared by main.ts (real bootstrap) and e2e tests, so tests exercise the exact
// same hardening wiring that runs in production — no risk of the two drifting apart.
export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const corsOrigins = parseCorsOrigins(
    configService.get<string>("CORS_ORIGINS", "http://localhost:3000"),
  );

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("StayBangla API")
    .setDescription(
      "StayBangla is a Bangladesh tourism-booking platform: hotel rooms, " +
        "vehicles, and (in progress) tour guides. This API serves traveler " +
        "booking flows, vendor listing management, SSLCommerz payment " +
        "confirmation, and admin verification/commission workflows.",
    )
    .setVersion("1.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "Paste the accessToken returned by /v1/auth/login, /v1/auth/otp/verify, " +
        "or /v1/auth/refresh.",
    })
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );
}
