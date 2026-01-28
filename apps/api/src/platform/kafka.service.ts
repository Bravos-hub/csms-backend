import 'dotenv/config';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, SASLOptions } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
    private readonly kafka: Kafka;
    private producer: Producer;
    private readonly logger = new Logger(KafkaService.name);

    constructor(private readonly config: ConfigService) {
        const brokers = this.config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(',');
        const clientId = 'evzone-backend';

        const ssl = this.config.get<string>('KAFKA_SSL') === 'true' ? { rejectUnauthorized: false } : false;
        let sasl: SASLOptions | undefined;

        const saslMechanism = this.config.get<string>('KAFKA_SASL_MECHANISM');
        if (saslMechanism) {
            const username = this.config.get<string>('KAFKA_SASL_USERNAME');
            const password = this.config.get<string>('KAFKA_SASL_PASSWORD');

            if (username && password) {
                sasl = {
                    mechanism: saslMechanism as 'plain' | 'scram-sha-256' | 'scram-sha-512',
                    username,
                    password
                };
            }
        }

        const kafkaConfig = {
            clientId,
            brokers,
            ssl: ssl as any,
            sasl,
            connectionTimeout: parseInt(process.env.KAFKA_CONNECTION_TIMEOUT_MS || '30000', 10),
            requestTimeout: parseInt(process.env.KAFKA_REQUEST_TIMEOUT_MS || '30000', 10),
            retry: {
                retries: 5,
                initialRetryTime: 300,
                maxRetryTime: 30000,
            }
        };
        this.kafka = new Kafka(kafkaConfig);

        try {
            this.producer = this.kafka.producer();
        } catch (error) {
            this.logger.error('Failed to create Kafka producer', error);
            throw error;
        }
    }

    async onModuleInit() {
        try {
            await this.producer.connect();
            this.logger.log('Kafka producer connected');
        } catch (error) {
            this.logger.error('Failed to connect Kafka producer', error);
            throw error;
        }
    }

    async onModuleDestroy() {
        try {
            await this.producer.disconnect();
            this.logger.log('Kafka producer disconnected');
        } catch (error) {
            this.logger.error('Failed to disconnect Kafka producer', error);
        }
    }

    async publish(topic: string, message: string, key?: string): Promise<void> {
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
