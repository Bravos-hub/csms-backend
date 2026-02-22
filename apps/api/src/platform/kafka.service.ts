import 'dotenv/config';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type KafkaConfig, Producer, SASLOptions } from 'kafkajs';
import * as fs from 'fs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private readonly logger = new Logger(KafkaService.name);
  private connected = false;

  constructor(private readonly config: ConfigService) {
    const brokers = this.config
      .get<string>('KAFKA_BROKERS', 'localhost:9092')
      .split(',');
    const clientId = 'evzone-backend';

    const sslEnabled = this.config.get<string>('KAFKA_SSL') === 'true';
    const rejectUnauthorized =
      this.config.get<string>('KAFKA_SSL_REJECT_UNAUTHORIZED', 'true') ===
      'true';
    if (sslEnabled && !rejectUnauthorized) {
      throw new Error('KAFKA_SSL_REJECT_UNAUTHORIZED=false is not allowed');
    }
    const caPath = this.config.get<string>('KAFKA_SSL_CA_PATH');
    if (caPath && !fs.existsSync(caPath)) {
      throw new Error(`KAFKA_SSL_CA_PATH not found: ${caPath}`);
    }
    const ssl: KafkaConfig['ssl'] = sslEnabled
      ? {
          rejectUnauthorized: true,
          ca: caPath ? [fs.readFileSync(caPath)] : undefined,
        }
      : false;
    let sasl: SASLOptions | undefined;

    const saslMechanism = this.config.get<string>('KAFKA_SASL_MECHANISM');
    if (saslMechanism) {
      const username = this.config.get<string>('KAFKA_SASL_USERNAME');
      const password = this.config.get<string>('KAFKA_SASL_PASSWORD');

      if (username && password) {
        sasl = {
          mechanism: saslMechanism as
            | 'plain'
            | 'scram-sha-256'
            | 'scram-sha-512',
          username,
          password,
        };
      }
    }

    const kafkaConfig: KafkaConfig = {
      clientId,
      brokers,
      ssl,
      sasl,
      connectionTimeout: parseInt(
        process.env.KAFKA_CONNECTION_TIMEOUT_MS || '30000',
        10,
      ),
      requestTimeout: parseInt(
        process.env.KAFKA_REQUEST_TIMEOUT_MS || '30000',
        10,
      ),
      retry: {
        retries: 5,
        initialRetryTime: 300,
        maxRetryTime: 30000,
      },
    };
    this.kafka = new Kafka(kafkaConfig);

    this.producer = this.kafka.producer();
  }

  async onModuleInit() {
    const requiredOnStartup =
      (this.config.get<string>('API_KAFKA_REQUIRED_ON_STARTUP', 'true') ??
        'true') === 'true';

    try {
      if (!this.producer) {
        throw new Error('Kafka producer is not initialized');
      }
      await this.producer.connect();
      this.connected = true;
      this.logger.log('Kafka producer connected');
    } catch (error) {
      this.connected = false;
      const message = error instanceof Error ? error.message : String(error);
      if (requiredOnStartup) {
        this.logger.error('Failed to connect Kafka producer', error);
        throw error;
      }
      this.logger.warn(
        `Kafka producer startup connection failed but API_KAFKA_REQUIRED_ON_STARTUP=false. Continuing without producer connection. Error: ${message}`,
      );
    }
  }

  async onModuleDestroy() {
    try {
      if (this.producer) {
        await this.producer.disconnect();
      }
      this.connected = false;
      this.logger.log('Kafka producer disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka producer', error);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async checkConnection(): Promise<{ status: 'up' | 'down'; error?: string }> {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin.disconnect();
      return { status: 'up' };
    } catch (error) {
      try {
        await admin.disconnect();
      } catch {
        // no-op
      }
      return {
        status: 'down',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async publish(topic: string, message: string, key?: string): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer is not initialized');
    }
    try {
      await this.producer.send({
        topic,
        messages: [{ key, value: message }],
      });
    } catch (error) {
      this.logger.error(`Failed to publish message to topic ${topic}`, error);
      throw error;
    }
  }
}
