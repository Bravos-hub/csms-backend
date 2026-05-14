import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma.module';
import { CommandsModule } from '../commands/commands.module';
import { SseModule } from '../sse/sse.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { TelemetryController } from './telemetry.controller';
import { SmartcarProviderService } from './smartcar-provider.service';
import { SmartcarTelemetryAdapter } from './providers/smartcar-telemetry.adapter';
import { SyntheticTelemetryAdapter } from './providers/synthetic-provider.adapter';
import { TelemetryProviderRegistryService } from './providers/telemetry-provider-registry.service';
import { TelemetryGatesService } from './telemetry-gates.service';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [ConfigModule, PrismaModule, CommandsModule, SseModule, WebhooksModule],
  controllers: [TelemetryController],
  providers: [
    TelemetryService,
    TelemetryGatesService,
    SmartcarProviderService,
    SmartcarTelemetryAdapter,
    SyntheticTelemetryAdapter,
    TelemetryProviderRegistryService,
  ],
  exports: [TelemetryService, TelemetryProviderRegistryService],
})
export class TelemetryModule {}
