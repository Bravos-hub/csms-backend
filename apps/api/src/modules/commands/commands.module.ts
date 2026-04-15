import { Module } from '@nestjs/common';
import { MqttModule } from '@app/mqtt';
import { PrismaModule } from '../../prisma.module';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';
import { CommandsMqttConsumer } from './commands-mqtt-consumer.service';

@Module({
  imports: [MqttModule.forRoot(), PrismaModule],
  controllers: [CommandsController],
  providers: [CommandsService, CommandsMqttConsumer],
  exports: [CommandsService],
})
export class CommandsModule {}
