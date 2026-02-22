import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandsWorkerModule } from './modules/commands/commands-worker.module';
import { WorkerHealthModule } from './modules/worker-health/worker-health.module';
import { KafkaModule } from './platform/kafka.module';
import { PrismaModule } from './prisma.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        PrismaModule,
        KafkaModule,
        CommandsWorkerModule,
        WorkerHealthModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule { }
