import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma.module'
import { KafkaModule } from '../../platform/kafka.module'
import { CommandOutboxWorker } from './outbox.worker'
import { CommandsController } from './commands.controller'
import { CommandsService } from './commands.service'

@Module({
  imports: [KafkaModule, PrismaModule],
  controllers: [CommandsController],
  providers: [CommandsService, CommandOutboxWorker],
  exports: [CommandsService],
})
export class CommandsModule { }
