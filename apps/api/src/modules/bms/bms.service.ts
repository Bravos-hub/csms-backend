import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as mqtt from 'mqtt';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class BmsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BmsService.name);
  private mqttClient: mqtt.MqttClient;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.connectToMqttBroker();
  }

  onModuleDestroy() {
    if (this.mqttClient) {
      this.mqttClient.end();
    }
  }

  private connectToMqttBroker() {
    const brokerUrl = this.configService.get<string>('MQTT_BROKER_URL');
    if (!brokerUrl) {
      this.logger.warn(
        'MQTT_BROKER_URL is not defined in .env. BMS telemetry ingestion is disabled.',
      );
      return;
    }

    const options: mqtt.IClientOptions = {
      username: this.configService.get<string>('MQTT_USERNAME'),
      password: this.configService.get<string>('MQTT_PASSWORD'),
      clientId: `evzone-backend-bms-${Math.random().toString(16).substr(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
      protocolVersion: 5, // Recommended for modern EMQX
    };

    try {
      this.mqttClient = mqtt.connect(brokerUrl, options);

      this.mqttClient.on('connect', () => {
        this.logger.log(`Connected to EMQX broker at ${brokerUrl}`);
        // Subscribe to our unified telemetry topic
        this.mqttClient.subscribe('evzone/telemetry/packs/+', (err) => {
          if (err) {
            this.logger.error(
              'Failed to subscribe to BMS telemetry topic',
              err,
            );
          } else {
            this.logger.log(
              'Subscribed to EVZONE pack telemetry stream: evzone/telemetry/packs/+',
            );
          }
        });
      });

      this.mqttClient.on('message', (topic, message) => {
        void this.handleIncomingTelemetry(topic, message.toString()).catch(
          (err) => {
            this.logger.error(
              `Error processing telemetry from topic ${topic}`,
              err,
            );
          },
        );
      });

      this.mqttClient.on('error', (err) => {
        this.logger.error('MQTT Client Error:', err);
      });
    } catch (e) {
      this.logger.error('Failed to initialize MQTT connection', e);
    }
  }

  private async handleIncomingTelemetry(topic: string, payload: string) {
    // Topic format: evzone/telemetry/packs/{packSerialNumber}
    const topicParts = topic.split('/');
    const packSerialNumber = topicParts[topicParts.length - 1];

    if (!packSerialNumber) return;

    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!this.isRecord(parsed)) {
        this.logger.warn(
          `Received non-object telemetry payload on topic ${topic}`,
        );
        return;
      }
      data = parsed;
    } catch {
      this.logger.warn(`Received malformed JSON payload on topic ${topic}`);
      return;
    }

    // Upsert the battery pack entity based on serial number
    let pack = await this.prisma.batteryPack.findUnique({
      where: { serialNumber: packSerialNumber },
    });

    if (!pack) {
      this.logger.log(
        `Registering new BatteryPack via Edge Gateway detection: ${packSerialNumber}`,
      );
      pack = await this.prisma.batteryPack.create({
        data: {
          serialNumber: packSerialNumber,
          bmsType: this.readString(data.bmsType) || 'UNKNOWN_3RD_PARTY',
          status: 'READY',
          capacityAh: this.readNumber(data.capacity) || 0,
        },
      });
    }

    // Only update DB telemetry if the pack isn't locked/dead
    if (pack.status === 'FAULTED' || pack.status === 'RETIRED') {
      return;
    }

    // 1. Create a historical telemetry entry
    await this.prisma.batteryTelemetry.create({
      data: {
        packId: pack.id,
        voltage: this.readNumber(data.voltage) || 0,
        current: this.readNumber(data.current) || 0,
        soc: this.readNumber(data.soc) || 0,
        soh: this.readNumber(data.soh) || null,
        temps: this.readNumberArray(data.temps),
        cells: this.readNumberArray(data.cellvolt),
        alerts: this.readRecord(data.alerts) || ({} as Prisma.JsonObject),
      },
    });

    const soc = this.readNumber(data.soc);
    const soh = this.readNumber(data.soh);
    const voltage = this.readNumber(data.voltage);
    const current = this.readNumber(data.current);
    const cycles = this.readNumber(data.cycles);

    // 2. Update current state of the proxy Pack model
    await this.prisma.batteryPack.update({
      where: { id: pack.id },
      data: {
        soc: soc ?? pack.soc,
        soh: soh ?? pack.soh,
        voltage: voltage ?? pack.voltage,
        current: current ?? pack.current,
        cycleCount: cycles ?? pack.cycleCount,
      },
    });
  }

  /**
   * Dispatches a highly-secure Kill Command to the Station Edge Gateway
   * which translates it into the hardware-specific BMS shutdown sequence.
   */
  async dispatchRemoteKill(
    packId: string,
    stationId: string,
    adminUserId: string,
  ): Promise<boolean> {
    const pack = await this.prisma.batteryPack.findUnique({
      where: { id: packId },
    });
    if (!pack) {
      throw new Error(`BatteryPack ${packId} not found`);
    }

    if (!this.mqttClient || !this.mqttClient.connected) {
      this.logger.error('Cannot dispatch Remote Kill - EMQX is disconnected.');
      throw new Error('MQTT client is not connected to EMQX');
    }

    const commandTopic = `evzone/secure/commands/${stationId}/packs/${pack.serialNumber}/kill`;

    // Construct a signed payload (in theory, you'd add a JWT/HMAC here for Edge validation)
    const payloadBuffer = JSON.stringify({
      action: 'KILL_MOSFET_OPEN',
      authorizedBy: adminUserId,
      timestamp: new Date().toISOString(),
    });

    return new Promise((resolve, reject) => {
      // QoS 1 ensures delivery at least once to the edge gateway if it's subscribed
      this.mqttClient.publish(
        commandTopic,
        payloadBuffer,
        { qos: 1 },
        async (err) => {
          if (err) {
            this.logger.error(
              `MQTT Publish failed for Remote Kill on ${pack.serialNumber}`,
              err,
            );
            reject(err);
          } else {
            this.logger.warn(
              `Remote Kill Command dispatched successfully for Pack ${pack.serialNumber}`,
            );
            // Lock the pack locally so we know not to route it
            await this.prisma.batteryPack.update({
              where: { id: packId },
              data: { status: 'LOCKED_REMOTE' },
            });
            resolve(true);
          }
        },
      );
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private readRecord(value: unknown): Prisma.JsonObject | undefined {
    return this.isRecord(value) ? (value as Prisma.JsonObject) : undefined;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private readNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const numbers = value
      .map((item) => this.readNumber(item))
      .filter((item): item is number => item !== undefined);
    return numbers;
  }
}
