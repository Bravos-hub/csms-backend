import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import type { SASLOptions } from 'kafkajs';
import { AppModule } from './app.module';
import { validateKafkaTopicsOrThrow } from './contracts/kafka-topics';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  try {
    validateKafkaTopicsOrThrow();
    const app = await NestFactory.create(AppModule);
    const kafkaEventsEnabled = (process.env.KAFKA_EVENTS_ENABLED ?? 'true') === 'true';
    if (kafkaEventsEnabled) {
      app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: process.env.KAFKA_EVENT_CLIENT_ID || 'evzone-backend-api',
            brokers: parseList(process.env.KAFKA_BROKERS ?? 'localhost:9092'),
            ssl: buildKafkaSslOptions(),
            sasl: buildKafkaSasl(),
          },
          consumer: {
            groupId: process.env.KAFKA_EVENT_GROUP_ID || 'evzone-backend-api-events',
          },
        },
      });
      await app.startAllMicroservices();
      console.log('Kafka event microservice listener started');
    }

    app.setGlobalPrefix('api/v1');

    // Enable cookie parser middleware
    app.use(cookieParser());

    // Enable global validation pipe
    const { ValidationPipe } = await import('@nestjs/common');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      transform: true, // Auto-transform payloads
      forbidNonWhitelisted: true, // Throw error for extra properties
    }));

    const corsOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : [
        'http://localhost:5173',
        'https://portal.evzonecharging.com',
      ];

    app.enableCors({
      origin: corsOrigins,
      credentials: true, // IMPORTANT: Enable credentials for cookies
    });

    // Swagger Configuration
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const config = new DocumentBuilder()
      .setTitle('EVZone API')
      .setDescription('EVZone Charging Platform API - Cookie-based Authentication')
      .setVersion('1.0')
      .addCookieAuth('evzone_access_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'evzone_access_token',
      })
      .addCookieAuth('evzone_refresh_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'evzone_refresh_token',
      })
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
    console.log(`API Documentation available at: http://localhost:${port}/api/docs`);
  } catch (error) {
    console.error('Failed to start application:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

function parseList(value?: string): string[] {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function buildKafkaSslOptions(): false | { rejectUnauthorized: true; ca?: Buffer[] } {
  if (process.env.KAFKA_SSL !== 'true') {
    return false;
  }
  const rejectUnauthorized = (process.env.KAFKA_SSL_REJECT_UNAUTHORIZED ?? 'true') === 'true';
  if (!rejectUnauthorized) {
    throw new Error('KAFKA_SSL_REJECT_UNAUTHORIZED=false is not allowed');
  }
  const caPath = process.env.KAFKA_SSL_CA_PATH;
  if (!caPath) {
    return { rejectUnauthorized: true };
  }
  if (!fs.existsSync(caPath)) {
    throw new Error(`KAFKA_SSL_CA_PATH not found: ${caPath}`);
  }
  return {
    rejectUnauthorized: true,
    ca: [fs.readFileSync(caPath)],
  };
}

function buildKafkaSasl(): SASLOptions | undefined {
  const mechanism = process.env.KAFKA_SASL_MECHANISM;
  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;
  if (!mechanism || !username || !password) {
    return undefined;
  }
  return {
    mechanism: mechanism as any,
    username,
    password,
  } as SASLOptions;
}

bootstrap().catch((error) => {
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});
