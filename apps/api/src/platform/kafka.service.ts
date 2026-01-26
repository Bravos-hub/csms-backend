import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Consumer, SASLOptions } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
    private readonly kafka: Kafka;
    private producer: Producer;
    private readonly logger = new Logger(KafkaService.name);

    constructor(private readonly config: ConfigService) {
        const brokers = this.config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(',');
        const clientId = 'evzone-backend';

        const ssl = this.config.get<string>('KAFKA_SSL') === 'true';
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

        this.kafka = new Kafka({
            clientId,
            brokers,
            ssl,
            sasl
        });

        this.producer = this.kafka.producer();
    }

    async onModuleInit() {
        await this.producer.connect();
        this.logger.log('Kafka producer connected');
    }

    async onModuleDestroy() {
        await this.producer.disconnect();
    }

    async publish(topic: string, message: string, key?: string): Promise<void> {
        await this.producer.send({
            topic,
            messages: [{ key, value: message }],
        });
    }
}
