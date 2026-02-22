import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
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
    kafka: {
      status: 'up' | 'down';
      required: boolean;
      producerConnected: boolean;
      eventsEnabled: boolean;
      eventConsumerGroup: string;
      error?: string;
    };
  }> {
    const [db, kafka] = await Promise.all([
      this.checkDatabase(),
      this.checkKafka(),
    ]);

    const ready =
      db.status === 'up' && (kafka.required ? kafka.status === 'up' : true);

    return { ready, db, kafka };
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
}
