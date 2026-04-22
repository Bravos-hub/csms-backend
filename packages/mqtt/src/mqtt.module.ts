import { randomBytes } from 'crypto';
import { hostname } from 'os';
import { Module, DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ClientsModule,
  ClientProvider,
  Transport,
} from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { MqttConfigService } from './mqtt.config';
import { MqttTenantContextService } from './mqtt-tenant-context.service';
import { MqttEventPublisherService } from './mqtt-event-publisher.service';
import { MqttConnectionManagerService } from './mqtt-connection-manager.service';

const MQTT_CLIENT_ID_MAX_LENGTH = 23;

function sanitizeClientIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function buildDefaultClientId(): string {
  const envToken = sanitizeClientIdSegment(process.env.NODE_ENV || 'dev').slice(
    0,
    3,
  );
  const hostToken = sanitizeClientIdSegment(hostname()).slice(0, 4);
  const processToken = Math.abs(process.pid).toString(36).slice(0, 4);
  const randomToken = randomBytes(3).toString('hex');

  const raw = `evz${envToken || 'dev'}${hostToken || 'host'}${
    processToken || 'proc'
  }${randomToken}`;

  return raw.slice(0, MQTT_CLIENT_ID_MAX_LENGTH);
}

function resolveClientId(): string {
  return buildDefaultClientId();
}

@Module({})
export class MqttModule {
  private static initialized = false;

  static forRoot(): DynamicModule {
    if (this.initialized) {
      return {
        module: MqttModule,
        global: true,
      };
    }

    this.initialized = true;

    return {
      module: MqttModule,
      global: true,
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
                console.warn(
                  'MQTT_BROKER_URL not configured - MQTT features will be disabled',
                );
                // Return a dummy MQTT provider that won't connect
                return {
                  transport: Transport.MQTT,
                  options: {
                    url: 'mqtt://localhost:1883',
                    username: 'disabled',
                    password: 'disabled',
                  },
                } as unknown as ClientProvider;
              }

              const qosValue =
                configService.get<number>('MQTT_QOS_COMMANDS') || 1;
              const validQos = Math.min(Math.max(qosValue, 0), 2) as 0 | 1 | 2;

              return {
                transport: Transport.MQTT,
                options: {
                  url: brokerUrl,
                  username:
                    configService.get<string>('MQTT_USERNAME') || 'api-service',
                  password:
                    configService.get<string>('MQTT_PASSWORD') || 'changeme',
                  subscribeOptions: {
                    qos: validQos,
                  },
                  clientId: resolveClientId(),
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
    };
  }
}
