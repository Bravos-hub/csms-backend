import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma.module';
import { BatterySwapPayloadNormalizer } from './payload-normalizer.service';
import { BatterySwapDeviceRegistryService } from './device-registry.service';
import { BatterySwapStateMachineService } from './state-machine.service';
import { BatterySwapMqttAdapterService } from './battery-swap-mqtt-adapter.service';
import { BatterySwapPersistenceService } from './battery-swap-persistence.service';

@Module({
  imports: [PrismaModule],
  providers: [
    BatterySwapPayloadNormalizer,
    BatterySwapDeviceRegistryService,
    BatterySwapStateMachineService,
    BatterySwapMqttAdapterService,
    BatterySwapPersistenceService,
  ],
  exports: [BatterySwapMqttAdapterService],
})
export class BatterySwapMqttAdapterModule {}
