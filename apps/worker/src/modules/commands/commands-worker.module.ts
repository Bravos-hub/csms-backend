import { Module } from '@nestjs/common';
import { CommandOutboxWorker } from './command-outbox.worker';
import { CommandEventsConsumer } from './command-events.consumer';
import { CommandHistoryCleanupWorker } from './command-history-cleanup.worker';
import { KafkaModule } from '../../platform/kafka.module';

@Module({
  imports: [KafkaModule],
  providers: [
    CommandOutboxWorker,
    CommandEventsConsumer,
    CommandHistoryCleanupWorker,
  ],
  exports: [CommandEventsConsumer],
})
export class CommandsWorkerModule {}
