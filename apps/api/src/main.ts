import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

// GLOBAL FIX: Allow self-signed certificates for DigitalOcean DB connections in development
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule);
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
bootstrap().catch((error) => {
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});
