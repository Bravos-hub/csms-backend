import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MqttModule } from '@app/mqtt';
import { SessionController } from './session-service.controller';
import { SessionService } from './session-service.service';
import { SessionMqttConsumer } from './session-mqtt-consumer.service';
import { NotificationServiceModule } from '../notification/notification-service.module';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import { EnergyManagementModule } from '../energy-management/energy-management.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    NotificationServiceModule,
    EnergyManagementModule,
    MqttModule.forRoot(),
    ClientsModule.register([
      {
        name: 'SESSION_SERVICE',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'session-service',
            brokers: ['localhost:9092'],
          },
          consumer: {
            groupId: 'session-service-consumer',
          },
        },
      },
    ]),
  ],
  controllers: [SessionController],
  providers: [SessionService, SessionMqttConsumer, OcpiTokenSyncService],
  exports: [SessionService],
})
export class SessionServiceModule {}
