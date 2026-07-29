import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap/configure-app";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = new DocumentBuilder()
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
    SwaggerModule.createDocument(app, config),
  );

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
}
void bootstrap();
