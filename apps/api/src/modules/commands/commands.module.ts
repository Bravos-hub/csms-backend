import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma.module'
import { CommandsController } from './commands.controller'
import { CommandsService } from './commands.service'

@Module({
  imports: [PrismaModule],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule { }
