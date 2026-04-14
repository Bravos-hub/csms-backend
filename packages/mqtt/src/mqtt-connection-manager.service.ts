import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class MqttConnectionManagerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MqttConnectionManagerService.name);
  private isConnected = false;

  constructor(@Inject('MQTT_SERVICE') private mqttClient: ClientProxy) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      await this.mqttClient.connect();
      this.isConnected = true;
      this.logger.log('Connected to MQTT broker');
    } catch (error) {
      this.logger.error(
        `Failed to connect to MQTT broker: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async disconnect(): Promise<void> {
    try {
      await this.mqttClient.close();
      this.isConnected = false;
      this.logger.log('Disconnected from MQTT broker');
    } catch (error) {
      this.logger.error(
        `Error disconnecting from MQTT broker: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  healthCheck(): void {
    try {
      this.mqttClient.emit('$SYS/healthcheck', {
        timestamp: new Date().toISOString(),
      });
      if (!this.isConnected) {
        this.logger.log('MQTT health check passed, connection restored');
        this.isConnected = true;
      }
    } catch (error) {
      this.isConnected = false;
      this.logger.error(
        `MQTT health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  async waitForReady(timeoutMs = 30000): Promise<void> {
    const startTime = Date.now();
    while (!this.isConnected) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('MQTT connection timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
