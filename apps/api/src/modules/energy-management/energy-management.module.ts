import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { CommandsModule } from '../commands/commands.module';
import { EnergyManagementController } from './energy-management.controller';
import { EnergyManagementService } from './energy-management.service';
import { EnergyManagementMqttConsumer } from './energy-management-mqtt-consumer.service';

@Module({
  imports: [PrismaModule, CommandsModule],
  controllers: [EnergyManagementController],
  providers: [EnergyManagementService, EnergyManagementMqttConsumer],
  exports: [EnergyManagementService],
})
export class EnergyManagementModule {}
