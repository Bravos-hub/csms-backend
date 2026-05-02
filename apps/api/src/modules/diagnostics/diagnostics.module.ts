import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { SseModule } from '../sse/sse.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [PrismaModule, SseModule, WebhooksModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
