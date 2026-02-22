import 'dotenv/config';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, Producer, SASLOptions } from 'kafkajs';
import * as fs from 'fs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
    private readonly kafka: Kafka;
    private producer: Producer;
    private readonly logger = new Logger(KafkaService.name);
    private readonly consumers = new Map<string, Consumer>();
    private connected = false;

    constructor(private readonly config: ConfigService) {
        const brokers = this.config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(',');
        const clientId = this.config.get<string>('KAFKA_CLIENT_ID', 'evzone-worker');

        const sslEnabled = this.config.get<string>('KAFKA_SSL') === 'true';
        const rejectUnauthorized = (this.config.get<string>('KAFKA_SSL_REJECT_UNAUTHORIZED', 'true') === 'true');
        if (sslEnabled && !rejectUnauthorized) {
            throw new Error('KAFKA_SSL_REJECT_UNAUTHORIZED=false is not allowed');
        }
        const caPath = this.config.get<string>('KAFKA_SSL_CA_PATH');
        if (caPath && !fs.existsSync(caPath)) {
            throw new Error(`KAFKA_SSL_CA_PATH not found: ${caPath}`);
        }
        const ssl = sslEnabled
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
                    mechanism: saslMechanism as 'plain' | 'scram-sha-256' | 'scram-sha-512',
                    username,
                    password,
                };
            }
        }

        this.kafka = new Kafka({
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
            },
        });
        this.producer = this.kafka.producer();
    }

    async onModuleInit() {
        try {
            await this.producer.connect();
            this.connected = true;
            this.logger.log('Kafka producer connected');
        } catch (error) {
            this.connected = false;
            this.logger.error('Failed to connect Kafka producer', error);
            throw error;
        }
    }

    async onModuleDestroy() {
        for (const [groupId, consumer] of this.consumers) {
            try {
                await consumer.disconnect();
                this.logger.log(`Kafka consumer disconnected for group ${groupId}`);
            } catch (error) {
                this.logger.error(`Failed to disconnect Kafka consumer for group ${groupId}`, error);
            }
        }
        this.consumers.clear();

        try {
            await this.producer.disconnect();
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

    async getConsumer(groupId: string): Promise<Consumer> {
        const existing = this.consumers.get(groupId);
        if (existing) return existing;

        const consumer = this.kafka.consumer({ groupId });
        await consumer.connect();
        this.consumers.set(groupId, consumer);
        this.logger.log(`Kafka consumer connected for group ${groupId}`);
        return consumer;
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

