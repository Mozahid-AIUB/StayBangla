import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap/configure-app";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = new DocumentBuilder().setTitle("StayBangla API").setVersion("0.0.0").build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
}
void bootstrap();
