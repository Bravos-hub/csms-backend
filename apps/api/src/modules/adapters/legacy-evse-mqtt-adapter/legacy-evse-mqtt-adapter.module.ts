import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma.module';
import { LegacyEvseMqttAdapterService } from './legacy-evse-mqtt-adapter.service';

@Module({
  imports: [PrismaModule],
  providers: [LegacyEvseMqttAdapterService],
  exports: [LegacyEvseMqttAdapterService],
})
export class LegacyEvseMqttAdapterModule {}
