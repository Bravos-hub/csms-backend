import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { KafkaService } from '../../platform/kafka.service'

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly kafka: KafkaService
  ) {}

  @Get()
  async getHealth() {
    const kafkaStatus = await this.kafka.checkConnection()
    const eventsEnabled = (process.env.KAFKA_EVENTS_ENABLED ?? 'true') === 'true'
    const status = kafkaStatus.status === 'down' && eventsEnabled ? 'degraded' : 'ok'

    return {
      status,
      service: this.config.get<string>('service.name'),
      time: new Date().toISOString(),
      kafka: {
        status: kafkaStatus.status,
        producerConnected: this.kafka.isConnected(),
        eventsEnabled,
        eventConsumerGroup: process.env.KAFKA_EVENT_GROUP_ID || 'evzone-backend-api-events',
        error: kafkaStatus.error,
      },
    }
  }
}
