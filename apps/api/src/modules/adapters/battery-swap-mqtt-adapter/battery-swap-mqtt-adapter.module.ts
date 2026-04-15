import { Module } from '@nestjs/common';
import { MqttModule } from '@app/mqtt';
import { PrismaModule } from '../../../prisma.module';
import { BatterySwapPayloadNormalizer } from './payload-normalizer.service';
import { BatterySwapDeviceRegistryService } from './device-registry.service';
import { BatterySwapStateMachineService } from './state-machine.service';
import { BatterySwapMqttAdapterService } from './battery-swap-mqtt-adapter.service';

@Module({
  imports: [MqttModule, PrismaModule],
  providers: [
    BatterySwapPayloadNormalizer,
    BatterySwapDeviceRegistryService,
    BatterySwapStateMachineService,
    BatterySwapMqttAdapterService,
  ],
  exports: [BatterySwapMqttAdapterService],
})
export class BatterySwapMqttAdapterModule {}
