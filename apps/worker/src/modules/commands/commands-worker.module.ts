import { Module } from '@nestjs/common';
import { CommandOutboxWorker } from './command-outbox.worker';
import { CommandEventsConsumer } from './command-events.consumer';
import { CommandHistoryCleanupWorker } from './command-history-cleanup.worker';
import { KafkaModule } from '../../platform/kafka.module';
import { OcpiCommandCallbackService } from './ocpi-command-callback.service';
import { WorkerTenantRoutingService } from './worker-tenant-routing.service';

@Module({
  imports: [KafkaModule],
  providers: [
    CommandOutboxWorker,
    CommandEventsConsumer,
    CommandHistoryCleanupWorker,
    OcpiCommandCallbackService,
    WorkerTenantRoutingService,
  ],
  exports: [CommandEventsConsumer],
})
export class CommandsWorkerModule {}
