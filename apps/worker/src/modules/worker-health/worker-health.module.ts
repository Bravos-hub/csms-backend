import { Module } from '@nestjs/common';
import { WorkerHealthController } from './worker-health.controller';
import { CommandsWorkerModule } from '../commands/commands-worker.module';

@Module({
    imports: [CommandsWorkerModule],
    controllers: [WorkerHealthController],
})
export class WorkerHealthModule { }

