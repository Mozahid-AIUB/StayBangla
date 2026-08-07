import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap/configure-app";
import { resolveListenPort } from "./bootstrap/listen-port";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  // 0.0.0.0 explicitly, not the default. Inside a container, binding to
  // localhost means the process is reachable only from within the container —
  // the platform's health check comes from outside and gets nothing, and the
  // container is killed as unhealthy while its own logs say it started fine.
  await app.listen(resolveListenPort(process.env), "0.0.0.0");
}
void bootstrap();
