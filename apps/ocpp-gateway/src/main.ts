import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { OcppGatewayModule } from './ocpp-gateway.module';

async function bootstrap() {
  const app = await NestFactory.create(OcppGatewayModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(process.env.port ?? 3003);
}
bootstrap();
