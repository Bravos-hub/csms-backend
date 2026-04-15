import { Module } from '@nestjs/common';
import { MqttModule } from '@app/mqtt';
import { PrismaModule } from '../../../prisma.module';
import { MqttEdgeAdapterService } from './mqtt-edge-adapter.service';

@Module({
  imports: [MqttModule.forRoot(), PrismaModule],
  providers: [MqttEdgeAdapterService],
  exports: [MqttEdgeAdapterService],
})
export class MqttEdgeAdapterModule {}
