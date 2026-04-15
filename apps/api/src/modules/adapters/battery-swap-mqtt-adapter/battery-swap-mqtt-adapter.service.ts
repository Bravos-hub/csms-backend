import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BaseMqttAdapter,
  AdapterDeviceInfo,
  AdapterPayloadValidationResult,
  AdapterCommandResult,
  MqttEventPublisherService,
} from '@app/mqtt';
import {
  BatterySwapPayloadNormalizer,
  RawVendorPayload,
} from './payload-normalizer.service';
import { BatterySwapDeviceRegistryService } from './device-registry.service';
import { BatterySwapStateMachineService } from './state-machine.service';

@Injectable()
export class BatterySwapMqttAdapterService extends BaseMqttAdapter {
  adapterName = 'BATTERY_SWAP_ADAPTER';
  private readonly logger = new Logger(BatterySwapMqttAdapterService.name);

  constructor(
    private readonly normalizer: BatterySwapPayloadNormalizer,
    private readonly registry: BatterySwapDeviceRegistryService,
    private readonly stateMachine: BatterySwapStateMachineService,
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

      // Basic schema check
      if (!parsed.device_id || typeof parsed.device_id !== 'string') {
        return await Promise.resolve({
          valid: false,
          errors: ['Missing or invalid device_id'],
        });
      }
      if (!parsed.type || typeof parsed.type !== 'string') {
        return await Promise.resolve({
          valid: false,
          errors: ['Missing or invalid type'],
        });
      }
      if (!parsed.data || typeof parsed.data !== 'object') {
        return await Promise.resolve({
          valid: false,
          errors: ['Missing or invalid data payload'],
        });
      }

      return await Promise.resolve({
        valid: true,
        errors: [],
        normalizedData: parsed,
      });
    } catch (error) {
      return await Promise.resolve({
        valid: false,
        errors: [
          `Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
        ],
      });
    }
  }

  async lookupDeviceRegistry(
    vendorDeviceId: string,
  ): Promise<AdapterDeviceInfo> {
    return this.registry.lookupDevice(vendorDeviceId);
  }

  async sendCommand(
    deviceInfo: AdapterDeviceInfo,
    command: Record<string, unknown>,
  ): Promise<AdapterCommandResult> {
    // In a real implementation this would format a command and publish down to the broker
    this.logger.debug(
      `Sending command to device ${deviceInfo.vendorDeviceId}: ${JSON.stringify(command)}`,
    );
    return await Promise.resolve({
      success: true,
      commandId: `cmd_${Date.now()}`,
      timestamp: new Date(),
    });
  }

  async validateEventSequence(
    deviceId: string,
    eventType: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    return this.stateMachine.validateEventSequence(deviceId, eventType);
  }

  async deduplicateEvent(
    deviceId: string,
    messageId: string,
    timestamp: Date,
  ): Promise<boolean> {
    return this.stateMachine.deduplicateEvent(deviceId, messageId, timestamp);
  }

  /**
   * Main entry point for a received vendor payload
   */
  async processIncomingPayload(topic: string, payload: Buffer): Promise<void> {
    const validation = await this.validateAndNormalizePayload(topic, payload);
    if (!validation.valid || !validation.normalizedData) {
      this.logger.warn(
        `Invalid payload on topic ${topic}: ${validation.errors.join(', ')}`,
      );
      // Could log to MqttVendorPayloadLog as error if we knew the tenant, but we don't yet without device ID
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

    // Persist raw audit log
    await this.registry.logPayload(
      deviceInfo.tenantId,
      deviceInfo.vendorDeviceId,
      topic,
      rawPayload as unknown as Prisma.InputJsonValue,
      rawPayload.type,
    );

    // Sequence & Deduplication checks
    // In actual implementation, we might extract message ID from MQTT properties or payload
    const messageId = String(rawPayload.ts || Date.now());
    const isDuplicate = await this.deduplicateEvent(
      deviceInfo.vendorDeviceId,
      messageId,
      new Date(),
    );
    if (isDuplicate) return;

    // Route to normalizer and publish canonical event to Core EVZONE
    try {
      switch (rawPayload.type) {
        case 'CABINET_STATUS': {
          const evt = this.normalizer.normalizeCabinetStatus(
            deviceInfo.tenantId,
            deviceInfo.internalSiteId,
            rawPayload,
          );
          this.eventPublisher.publishBatteryCabinetStatus(
            evt,
            deviceInfo.tenantId,
          );
          break;
        }
        case 'PACK_STATE': {
          const evt = this.normalizer.normalizePackState(
            deviceInfo.tenantId,
            deviceInfo.internalSiteId,
            rawPayload,
          );
          this.eventPublisher.publishBatteryPackState(evt, deviceInfo.tenantId);
          break;
        }
        case 'SESSION_UPDATE': {
          const evt = this.normalizer.normalizeSessionEvent(
            deviceInfo.tenantId,
            deviceInfo.internalSiteId,
            rawPayload,
          );
          await this.validateEventSequence(
            deviceInfo.vendorDeviceId,
            evt.stage,
          );
          this.eventPublisher.publishBatterySwapSession(
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
}
