import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
import * as fs from 'fs';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import type { SASLOptions } from 'kafkajs';
import { json, urlencoded } from 'express';
import type { Request } from 'express';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';
import {
  requestContextMiddleware,
  requestLoggingMiddleware,
} from './common/observability/request-logging.middleware';
import { TenantContextService, TenantRoutingConfigService } from '@app/db';
import { TenantResolutionService } from './common/tenant/tenant-resolution.service';
import { createTenantResolutionMiddleware } from './common/tenant/tenant-resolution.middleware';
import { DatabaseConnectivityExceptionFilter } from './common/filters/database-connectivity-exception.filter';
import { validateKafkaTopicsOrThrow } from './contracts/kafka-topics';
import { PrismaService } from './prisma.service';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  try {
    validateKafkaTopicsOrThrow();
    const app = await NestFactory.create(AppModule);
    const httpAdapterHost = app.get(HttpAdapterHost);
    app.useGlobalFilters(
      new DatabaseConnectivityExceptionFilter(httpAdapterHost),
    );

    const kafkaEventsEnabled =
      (process.env.KAFKA_EVENTS_ENABLED ?? 'true') === 'true';
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
            groupId:
              process.env.KAFKA_EVENT_GROUP_ID || 'evzone-backend-api-events',
          },
        },
      });
      await app.startAllMicroservices();
      console.log('Kafka event microservice listener started');
    }

    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
        { path: 'health/metrics', method: RequestMethod.GET },
        { path: 'health/metrics/prometheus', method: RequestMethod.GET },
      ],
    });

    const bodyLimit = process.env.API_BODY_LIMIT || '1mb';
    app.use(requestContextMiddleware);
    const tenantContext = app.get(TenantContextService);
    const tenantResolution = app.get(TenantResolutionService);
    app.use(createTenantResolutionMiddleware(tenantContext, tenantResolution));
    app.use(requestLoggingMiddleware);
    app.use(
      json({
        limit: bodyLimit,
        verify: (
          req: Request & { rawBody?: string },
          _res: unknown,
          buffer: Buffer,
        ) => {
          const requestUrl = req.originalUrl || req.url;
          if (shouldCaptureRawBody(requestUrl)) {
            req.rawBody = buffer.toString('utf8');
          }
        },
      }),
    );
    app.use(urlencoded({ extended: true, limit: bodyLimit }));

    // Enable cookie parser middleware
    app.use(cookieParser());

    // Enable global validation pipe
    const { ValidationPipe } = await import('@nestjs/common');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true, // Strip properties not in DTO
        transform: true, // Auto-transform payloads
        forbidNonWhitelisted: true, // Throw error for extra properties
      }),
    );

    const corsOrigins = buildCorsOrigins();
    const prismaService = app.get(PrismaService);
    const tenantRoutingConfig = app.get(TenantRoutingConfigService);
    const platformHosts = tenantRoutingConfig.getPlatformHosts();

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => {
        void isCorsOriginAllowed(origin, {
          corsOrigins,
          platformHosts,
          prismaService,
        })
          .then((allowed) => callback(null, allowed))
          .catch(() => callback(new Error('Not allowed by CORS'), false));
      },
      credentials: true, // IMPORTANT: Enable credentials for cookies
    });

    // Swagger Configuration
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const config = new DocumentBuilder()
      .setTitle('EVZone API')
      .setDescription(
        'EVZone Charging Platform API - Cookie-based Authentication',
      )
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

    const httpServer = app.getHttpServer() as {
      requestTimeout?: number;
      headersTimeout?: number;
      keepAliveTimeout?: number;
    };
    const requestTimeoutMs = parseInt(
      process.env.API_REQUEST_TIMEOUT_MS || '30000',
      10,
    );
    const headersTimeoutMs = parseInt(
      process.env.API_HEADERS_TIMEOUT_MS || '35000',
      10,
    );
    const keepAliveTimeoutMs = parseInt(
      process.env.API_KEEP_ALIVE_TIMEOUT_MS || '5000',
      10,
    );
    httpServer.requestTimeout = requestTimeoutMs;
    httpServer.headersTimeout = headersTimeoutMs;
    httpServer.keepAliveTimeout = keepAliveTimeoutMs;

    console.log(`Application is running on: http://localhost:${port}`);
    console.log(
      `API Documentation available at: http://localhost:${port}/api/docs`,
    );
  } catch (error) {
    console.error(
      'Failed to start application:',
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shouldCaptureRawBody(url: string): boolean {
  return (
    url.includes('/payments/webhooks/stripe') ||
    url.includes('/payments/webhooks/flutterwave') ||
    url.includes('/payments/webhooks/alipay') ||
    url.includes('/payments/webhooks/lianlian')
  );
}

function buildCorsOrigins(): string[] {
  const defaults = [
    'http://localhost:5173',
    'https://portal.evzonecharging.com',
  ];
  const configured = parseList(process.env.CORS_ORIGINS);
  const origins = normalizeCorsOrigins(
    configured.length > 0 ? configured : defaults,
  );
  validateCorsOriginsOrThrow(origins);
  console.log(`CORS allowlist: ${origins.join(', ')}`);
  return origins;
}

function normalizeRequestOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function extractHostFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function resolveTenantSubdomainFromHost(
  host: string,
  platformHosts: string[],
): string | null {
  for (const root of platformHosts) {
    const normalizedRoot = root.trim().toLowerCase();
    if (!normalizedRoot) continue;
    if (host === normalizedRoot) {
      return null;
    }
    const suffix = `.${normalizedRoot}`;
    if (!host.endsWith(suffix)) continue;
    const prefix = host.slice(0, -suffix.length);
    if (!prefix) return null;
    const firstLabel = prefix.split('.')[0]?.trim().toLowerCase();
    if (!firstLabel || !/^[a-z0-9-]+$/.test(firstLabel)) {
      return null;
    }
    return firstLabel;
  }
  return null;
}

async function isCorsOriginAllowed(
  origin: string | undefined,
  input: {
    corsOrigins: string[];
    platformHosts: string[];
    prismaService: PrismaService;
  },
): Promise<boolean> {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeRequestOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (input.corsOrigins.includes(normalizedOrigin)) {
    return true;
  }

  const host = extractHostFromOrigin(normalizedOrigin);
  if (!host) {
    return false;
  }

  const controlPlane = input.prismaService.getControlPlaneClient();

  const organizationByDomain = await controlPlane.organization.findFirst({
    where: {
      OR: [
        {
          primaryDomain: {
            equals: host,
            mode: 'insensitive',
          },
        },
        {
          allowedOrigins: {
            has: normalizedOrigin,
          },
        },
      ],
    },
    select: { id: true },
  });

  if (organizationByDomain) {
    return true;
  }

  const tenantSubdomain = resolveTenantSubdomainFromHost(
    host,
    input.platformHosts,
  );
  if (!tenantSubdomain) {
    return false;
  }

  const organizationBySubdomain = await controlPlane.organization.findFirst({
    where: {
      tenantSubdomain: {
        equals: tenantSubdomain,
        mode: 'insensitive',
      },
    },
    select: { id: true },
  });

  return Boolean(organizationBySubdomain);
}

function normalizeCorsOrigins(origins: string[]): string[] {
  const normalized = origins.map((origin) => {
    const parsed = new URL(origin);
    return parsed.origin;
  });
  return Array.from(new Set(normalized));
}

function validateCorsOriginsOrThrow(origins: string[]): void {
  if (origins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must contain at least one origin when credentials are enabled',
    );
  }

  if (origins.includes('*')) {
    throw new Error(
      'CORS wildcard (*) is not allowed when credentials are enabled',
    );
  }

  const isProduction = process.env.NODE_ENV === 'production';

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported CORS origin protocol: ${origin}`);
    }

    const host = parsed.hostname.toLowerCase();
    const isLocal =
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (isProduction && parsed.protocol !== 'https:' && !isLocal) {
      throw new Error(
        `In production, CORS origins must use https (except localhost): ${origin}`,
      );
    }
  }
}

function buildKafkaSslOptions():
  | false
  | { rejectUnauthorized: true; ca?: Buffer[] } {
  if (process.env.KAFKA_SSL !== 'true') {
    return false;
  }
  const rejectUnauthorized =
    (process.env.KAFKA_SSL_REJECT_UNAUTHORIZED ?? 'true') === 'true';
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

  const supportedMechanisms = [
    'plain',
    'scram-sha-256',
    'scram-sha-512',
  ] as const;
  if (
    !supportedMechanisms.includes(
      mechanism as (typeof supportedMechanisms)[number],
    )
  ) {
    return undefined;
  }
  const typedMechanism = mechanism as (typeof supportedMechanisms)[number];

  return {
    mechanism: typedMechanism,
    username,
    password,
  };
}

bootstrap().catch((error) => {
  console.error(
    'Bootstrap failed:',
    error instanceof Error ? error.message : error,
  );
  if (error instanceof Error && error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});
