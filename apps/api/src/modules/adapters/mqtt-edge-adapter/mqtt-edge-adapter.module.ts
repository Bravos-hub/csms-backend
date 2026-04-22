import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma.module';
import { MqttEdgeAdapterService } from './mqtt-edge-adapter.service';

@Module({
  imports: [PrismaModule],
  providers: [MqttEdgeAdapterService],
  exports: [MqttEdgeAdapterService],
})
export class MqttEdgeAdapterModule {}
