import { Module } from '@nestjs/common';
import { CommandOutboxWorker } from './command-outbox.worker';
import { CommandEventsConsumer } from './command-events.consumer';
import { CommandHistoryCleanupWorker } from './command-history-cleanup.worker';

@Module({
  providers: [
    CommandOutboxWorker,
    CommandEventsConsumer,
    CommandHistoryCleanupWorker,
  ],
  exports: [CommandEventsConsumer],
})
export class CommandsWorkerModule {}
