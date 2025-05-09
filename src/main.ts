import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app)); // Usa WebSocket puro
  await app.listen(8081);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
