import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { KafkaModule } from '../../platform/kafka.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PrismaModule, KafkaModule],
  controllers: [HealthController],
})
export class HealthModule {}
