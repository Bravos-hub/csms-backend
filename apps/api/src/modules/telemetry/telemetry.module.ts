import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma.module';
import { CommandsModule } from '../commands/commands.module';
import { SseModule } from '../sse/sse.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [ConfigModule, PrismaModule, CommandsModule, SseModule, WebhooksModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
