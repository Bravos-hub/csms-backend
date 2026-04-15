import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface MqttBrokerConfig {
  url: string;
  username: string;
  password: string;
  poolSize: number;
  reconnectDelayMs: number;
  healthCheckIntervalMs: number;
  qosCommand: number;
  qosTelemetry: number;
}

export interface VendorMqttIngressConfig {
  url: string;
  username: string;
  password: string;
}

@Injectable()
export class MqttConfigService {
  constructor(private configService: ConfigService) {}

  getCoreBrokerConfig(): MqttBrokerConfig {
    const url = this.configService.get<string>('MQTT_BROKER_URL');
    if (!url) {
      throw new Error('MQTT_BROKER_URL environment variable is required');
    }

    return {
      url,
      username:
        this.configService.get<string>('MQTT_USERNAME') || 'api-service',
      password: this.configService.get<string>('MQTT_PASSWORD') || 'changeme',
      poolSize: this.configService.get<number>('MQTT_POOL_SIZE') || 10,
      reconnectDelayMs:
        this.configService.get<number>('MQTT_RECONNECT_DELAY_MS') || 3000,
      healthCheckIntervalMs:
        this.configService.get<number>('MQTT_HEALTH_CHECK_INTERVAL_MS') ||
        30000,
      qosCommand: this.configService.get<number>('MQTT_QOS_COMMANDS') || 1,
      qosTelemetry: this.configService.get<number>('MQTT_QOS_TELEMETRY') || 0,
    };
  }

  getVendorIngressConfig(): VendorMqttIngressConfig | null {
    const url = this.configService.get<string>('VENDOR_MQTT_INGRESS_URL');
    if (!url) {
      return null;
    }

    return {
      url,
      username:
        this.configService.get<string>('VENDOR_MQTT_USERNAME') ||
        'vendor-ingress',
      password:
        this.configService.get<string>('VENDOR_MQTT_PASSWORD') || 'changeme',
    };
  }
}
