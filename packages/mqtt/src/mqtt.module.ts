import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport, ClientProvider } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { MqttConfigService } from './mqtt.config';
import { MqttTenantContextService } from './mqtt-tenant-context.service';
import { MqttEventPublisherService } from './mqtt-event-publisher.service';
import { MqttConnectionManagerService } from './mqtt-connection-manager.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      {
        name: 'MQTT_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService): ClientProvider => {
          const brokerUrl = configService.get<string>('MQTT_BROKER_URL');
          if (!brokerUrl) {
            throw new Error('MQTT_BROKER_URL not configured');
          }

          const qosValue = configService.get<number>('MQTT_QOS_COMMANDS') || 1;
          const validQos = Math.min(Math.max(qosValue, 0), 2) as 0 | 1 | 2;

          return {
            transport: Transport.MQTT,
            options: {
              url: brokerUrl,
              username: configService.get<string>('MQTT_USERNAME') || 'api-service',
              password: configService.get<string>('MQTT_PASSWORD') || 'changeme',
              subscribeOptions: {
                qos: validQos,
              },
              clientId: `evzone-api-${process.env.NODE_ENV || 'dev'}-${Date.now()}`,
            },
          } as unknown as ClientProvider;
        },
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [
    MqttConfigService,
    MqttTenantContextService,
    MqttEventPublisherService,
    MqttConnectionManagerService,
  ],
  exports: [
    MqttConfigService,
    MqttTenantContextService,
    MqttEventPublisherService,
    MqttConnectionManagerService,
    ClientsModule,
  ],
})
export class MqttModule {}
