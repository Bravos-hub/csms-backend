import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';
import { CommandsMqttConsumer } from './commands-mqtt-consumer.service';

@Module({
  imports: [PrismaModule],
  controllers: [CommandsController],
  providers: [CommandsService, CommandsMqttConsumer],
  exports: [CommandsService],
})
export class CommandsModule {}
