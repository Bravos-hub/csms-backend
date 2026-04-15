import { Injectable, Logger } from '@nestjs/common';
import {
  BaseMqttAdapter,
  AdapterDeviceInfo,
  AdapterPayloadValidationResult,
  AdapterCommandResult,
  MqttEventPublisherService,
} from '@app/mqtt';
import { PrismaService } from '../../../prisma.service';

interface RawVendorPayload {
  device_id: string;
  type: string;
  ts?: string;
  data: Record<string, unknown>;
}

interface LegacyEvseStatusPayload {
  connectorStatus: string;
  connectorPower: number;
  voltage: number;
  current: number;
  vendorStatus?: string;
}

interface LegacyEvseTransactionPayload {
  transactionId: string;
  userId?: string;
  rfidTag?: string;
  startTime?: string;
  endTime?: string;
  energyDelivered: number;
  status: string;
}

@Injectable()
export class LegacyEvseMqttAdapterService extends BaseMqttAdapter {
  adapterName = 'LEGACY_EVSE_ADAPTER';
  private readonly logger = new Logger(LegacyEvseMqttAdapterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: MqttEventPublisherService,
  ) {
    super();
  }

  async validateAndNormalizePayload(
    topic: string,
    payload: Buffer,
  ): Promise<AdapterPayloadValidationResult> {
    try {
      const parsed = JSON.parse(payload.toString()) as Record<string, unknown>;

      if (!parsed.device_id || typeof parsed.device_id !== 'string') {
        return {
          valid: false,
          errors: ['Missing or invalid device_id'],
        };
      }
      if (!parsed.type || typeof parsed.type !== 'string') {
        return {
          valid: false,
          errors: ['Missing or invalid type'],
        };
      }
      if (!parsed.data || typeof parsed.data !== 'object') {
        return {
          valid: false,
          errors: ['Missing or invalid data payload'],
        };
      }

      return {
        valid: true,
        errors: [],
        normalizedData: parsed,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [
          `Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }

  async lookupDeviceRegistry(
    vendorDeviceId: string,
  ): Promise<AdapterDeviceInfo> {
    const registry = await this.prisma.mqttDeviceRegistry.findFirst({
      where: {
        vendorDeviceId,
        integrationType: 'LEGACY_EVSE',
        isActive: true,
      },
      include: { site: true },
    });

    if (!registry) {
      throw new Error(`Device not found: ${vendorDeviceId}`);
    }

    return {
      vendorDeviceId: registry.vendorDeviceId,
      vendorProviderId: registry.vendorProviderId || '',
      internalStationId: registry.stationId || '',
      internalSiteId: registry.siteId,
      tenantId: registry.tenantId,
      capabilities: registry.capabilities as AdapterDeviceInfo['capabilities'],
    };
  }

  async sendCommand(
    deviceInfo: AdapterDeviceInfo,
    command: Record<string, unknown>,
  ): Promise<AdapterCommandResult> {
    this.logger.debug(
      `Sending command to legacy EVSE ${deviceInfo.vendorDeviceId}: ${JSON.stringify(command)}`,
    );

    return {
      success: true,
      commandId: `legacy-cmd-${Date.now()}`,
      timestamp: new Date(),
    };
  }

  async validateEventSequence(
    deviceId: string,
    eventType: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true };
  }

  async deduplicateEvent(
    deviceId: string,
    messageId: string,
    timestamp: Date,
  ): Promise<boolean> {
    return false;
  }

  async processIncomingPayload(topic: string, payload: Buffer): Promise<void> {
    const validation = await this.validateAndNormalizePayload(topic, payload);

    if (!validation.valid || !validation.normalizedData) {
      this.logger.warn(
        `Invalid payload on topic ${topic}: ${validation.errors.join(', ')}`,
      );
      return;
    }

    const rawPayload = validation.normalizedData as unknown as RawVendorPayload;

    let deviceInfo: AdapterDeviceInfo;
    try {
      deviceInfo = await this.lookupDeviceRegistry(rawPayload.device_id);
    } catch (err) {
      this.logger.warn(
        `Ignoring payload for unknown device ${rawPayload.device_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    await this.logPayload(
      deviceInfo.tenantId,
      deviceInfo.vendorDeviceId,
      topic,
      rawPayload as unknown as any,
      rawPayload.type,
    );

    const messageId = String(rawPayload.ts || Date.now());
    const isDuplicate = await this.deduplicateEvent(
      deviceInfo.vendorDeviceId,
      messageId,
      new Date(),
    );
    if (isDuplicate) return;

    try {
      switch (rawPayload.type) {
        case 'STATUS': {
          const statusData =
            rawPayload.data as unknown as LegacyEvseStatusPayload;
          const evt = {
            tenantId: deviceInfo.tenantId,
            siteId: deviceInfo.internalSiteId,
            timestamp: new Date(),
            chargerId: deviceInfo.vendorDeviceId,
            connectorStatus: this.normalizeConnectorStatus(
              statusData.connectorStatus,
            ),
            connectorPower: statusData.connectorPower || 0,
            voltage: statusData.voltage || 0,
            current: statusData.current || 0,
            vendorStatus: statusData.vendorStatus || '',
          };
          this.eventPublisher.publishLegacyEvseStatus(evt, deviceInfo.tenantId);
          break;
        }
        case 'TRANSACTION': {
          const txData =
            rawPayload.data as unknown as LegacyEvseTransactionPayload;
          const evt = {
            tenantId: deviceInfo.tenantId,
            siteId: deviceInfo.internalSiteId,
            timestamp: new Date(),
            chargerId: deviceInfo.vendorDeviceId,
            transactionId: txData.transactionId,
            userId: txData.userId,
            rfidTag: txData.rfidTag,
            startTime: txData.startTime
              ? new Date(txData.startTime)
              : new Date(),
            endTime: txData.endTime ? new Date(txData.endTime) : undefined,
            energyDelivered: txData.energyDelivered || 0,
            status: this.normalizeTransactionStatus(txData.status),
          };
          this.eventPublisher.publishLegacyEvseTransaction(
            evt,
            deviceInfo.tenantId,
          );
          break;
        }
        default:
          this.logger.debug(
            `Unhandled payload type ${rawPayload.type} for device ${deviceInfo.vendorDeviceId}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Error processing payload type ${rawPayload.type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async logPayload(
    tenantId: string,
    vendorDeviceId: string,
    topic: string,
    payload: unknown,
    eventType: string,
  ): Promise<void> {
    try {
      await this.prisma.mqttVendorPayloadLog.create({
        data: {
          tenantId,
          vendorDeviceId,
          topic,
          payload: payload as any,
          normalizedEventType: eventType,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to log vendor payload: ${error}`);
    }
  }

  private normalizeConnectorStatus(
    status: string,
  ): 'AVAILABLE' | 'OCCUPIED' | 'UNAVAILABLE' | 'FAULTED' {
    const upper = status?.toUpperCase() || '';
    if (
      upper.includes('AVAILABLE') ||
      upper.includes('FREE') ||
      upper.includes('IDLE')
    ) {
      return 'AVAILABLE';
    }
    if (
      upper.includes('CHARGING') ||
      upper.includes('OCCUPIED') ||
      upper.includes('BUSY')
    ) {
      return 'OCCUPIED';
    }
    if (
      upper.includes('FAULT') ||
      upper.includes('ERROR') ||
      upper.includes('DOWN')
    ) {
      return 'FAULTED';
    }
    return 'UNAVAILABLE';
  }

  private normalizeTransactionStatus(
    status: string,
  ): 'STARTED' | 'COMPLETED' | 'STOPPED' | 'ERROR' {
    const upper = status?.toUpperCase() || '';
    if (upper.includes('START') || upper.includes('BEGIN')) {
      return 'STARTED';
    }
    if (
      upper.includes('COMPLETE') ||
      upper.includes('FINISH') ||
      upper.includes('SUCCESS')
    ) {
      return 'COMPLETED';
    }
    if (upper.includes('STOP') || upper.includes('CANCEL')) {
      return 'STOPPED';
    }
    return 'ERROR';
  }
}
