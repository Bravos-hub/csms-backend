import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // Application context for worker (no HTTP server by default)
  // If you need microservice listener:
  // app.connectMicroservice({...});
  // await app.startAllMicroservices();
  console.log('Worker application started');
}
bootstrap();
