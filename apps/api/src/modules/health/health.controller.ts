import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as fs from 'fs';
import Redis, { RedisOptions } from 'ioredis';
import { HttpMetricsService } from '../../common/observability/http-metrics.service';
import { PrismaService } from '../../prisma.service';
import { KafkaService } from '../../platform/kafka.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly httpMetrics: HttpMetricsService,
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  @Get()
  async getHealth() {
    const report = await this.buildDependencyReport();
    const status = report.ready ? 'ok' : 'degraded';

    return {
      status,
      service: this.config.get<string>('service.name', 'evzone-backend-api'),
      time: new Date().toISOString(),
      db: report.db,
      redis: report.redis,
      kafka: report.kafka,
    };
  }

  @Get('live')
  getLiveness() {
    return {
      status: 'ok',
      service: this.config.get<string>('service.name', 'evzone-backend-api'),
      time: new Date().toISOString(),
    };
  }

  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) response: Response) {
    const report = await this.buildDependencyReport();
    const status = report.ready ? 'ok' : 'degraded';
    response.status(
      report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return {
      status,
      service: this.config.get<string>('service.name', 'evzone-backend-api'),
      time: new Date().toISOString(),
      db: report.db,
      redis: report.redis,
      kafka: report.kafka,
    };
  }

  @Get('metrics')
  getHttpMetrics() {
    return {
      status: 'ok',
      service: this.config.get<string>('service.name', 'evzone-backend-api'),
      time: new Date().toISOString(),
      http: this.httpMetrics.snapshot(),
    };
  }

  private async buildDependencyReport(): Promise<{
    ready: boolean;
    db: { status: 'up' | 'down'; error?: string };
    redis: {
      status: 'up' | 'down';
      required: boolean;
      error?: string;
    };
    kafka: {
      status: 'up' | 'down';
      required: boolean;
      producerConnected: boolean;
      eventsEnabled: boolean;
      eventConsumerGroup: string;
      error?: string;
    };
  }> {
    const [db, redis, kafka] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkKafka(),
    ]);

    const ready =
      db.status === 'up' &&
      (redis.required ? redis.status === 'up' : true) &&
      (kafka.required ? kafka.status === 'up' : true);

    return { ready, db, redis, kafka };
  }

  private async checkDatabase(): Promise<{
    status: 'up' | 'down';
    error?: string;
  }> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'up' };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkKafka(): Promise<{
    status: 'up' | 'down';
    required: boolean;
    producerConnected: boolean;
    eventsEnabled: boolean;
    eventConsumerGroup: string;
    error?: string;
  }> {
    const eventsEnabled =
      (process.env.KAFKA_EVENTS_ENABLED ?? 'true') === 'true';
    const readinessRequiresKafka =
      (process.env.API_READINESS_REQUIRE_KAFKA ?? 'false') === 'true';
    const required = eventsEnabled || readinessRequiresKafka;
    const status = await this.kafka.checkConnection();

    return {
      status: status.status,
      required,
      producerConnected: this.kafka.isConnected(),
      eventsEnabled,
      eventConsumerGroup:
        process.env.KAFKA_EVENT_GROUP_ID || 'evzone-backend-api-events',
      error: status.error,
    };
  }

  private async checkRedis(): Promise<{
    status: 'up' | 'down';
    required: boolean;
    error?: string;
  }> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    const required =
      (process.env.API_READINESS_REQUIRE_REDIS ?? 'false') === 'true';

    if (!redisUrl) {
      return {
        status: 'down',
        required,
        error: 'REDIS_URL is not set',
      };
    }

    const options = this.buildRedisTlsOptions();
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      ...options,
    });

    try {
      await client.connect();
      await client.ping();
      return { status: 'up', required };
    } catch (error) {
      return {
        status: 'down',
        required,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.disconnect();
    }
  }

  private buildRedisTlsOptions(): Pick<RedisOptions, 'tls'> {
    const redisUrl = this.config.get<string>('REDIS_URL', '');
    const tlsEnabled =
      this.config.get<string>('REDIS_TLS') === 'true' ||
      redisUrl.startsWith('rediss://');
    if (!tlsEnabled) {
      return {};
    }

    const rejectUnauthorized =
      this.config.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED', 'true') ===
      'true';
    if (!rejectUnauthorized) {
      throw new Error('REDIS_TLS_REJECT_UNAUTHORIZED=false is not allowed');
    }

    const caPath = this.config.get<string>('REDIS_TLS_CA_PATH');
    if (caPath && !fs.existsSync(caPath)) {
      throw new Error(`REDIS_TLS_CA_PATH not found: ${caPath}`);
    }

    return {
      tls: {
        rejectUnauthorized: true,
        ca: caPath ? fs.readFileSync(caPath, 'utf8') : undefined,
      },
    };
  }
}
