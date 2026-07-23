import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = new DocumentBuilder().setTitle("StayBangla API").setVersion("0.0.0").build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));
  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
}
void bootstrap();
