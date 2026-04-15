import { Module } from '@nestjs/common';
import { MqttModule } from '@app/mqtt';
import { PrismaModule } from '../../../prisma.module';
import { LegacyEvseMqttAdapterService } from './legacy-evse-mqtt-adapter.service';

@Module({
  imports: [MqttModule, PrismaModule],
  providers: [LegacyEvseMqttAdapterService],
  exports: [LegacyEvseMqttAdapterService],
})
export class LegacyEvseMqttAdapterModule {}
