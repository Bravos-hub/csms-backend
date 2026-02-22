import { Module } from '@nestjs/common';
import { CommandOutboxWorker } from './command-outbox.worker';
import { CommandEventsConsumer } from './command-events.consumer';

@Module({
    providers: [CommandOutboxWorker, CommandEventsConsumer],
    exports: [CommandEventsConsumer],
})
export class CommandsWorkerModule { }

