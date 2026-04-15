import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { AdapterDeviceInfo } from '@app/mqtt';

@Injectable()
export class BatterySwapDeviceRegistryService {
  private readonly logger = new Logger(BatterySwapDeviceRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async lookupDevice(vendorDeviceId: string): Promise<AdapterDeviceInfo> {
    const registry = await this.prisma.mqttDeviceRegistry.findFirst({
      where: { vendorDeviceId, isActive: true },
      include: { site: true },
    });

    if (!registry) {
      throw new NotFoundException(
        `Device ${vendorDeviceId} not found or inactive`,
      );
    }

    const capabilities = registry.capabilities as Record<string, unknown>;

    return {
      vendorDeviceId: registry.vendorDeviceId,
      vendorProviderId: registry.vendorProviderId || 'UNKNOWN_PROVIDER',
      internalStationId: registry.stationId || 'UNKNOWN_STATION',
      internalSiteId: registry.siteId,
      tenantId: registry.tenantId,
      capabilities: {
        canRemoteControl:
          typeof capabilities?.canRemoteControl === 'boolean'
            ? capabilities.canRemoteControl
            : false,
        canReceiveCommands:
          typeof capabilities?.canReceiveCommands === 'boolean'
            ? capabilities.canReceiveCommands
            : false,
        supportsMetering:
          typeof capabilities?.supportsMetering === 'boolean'
            ? capabilities.supportsMetering
            : false,
        supportsSmartCharging:
          typeof capabilities?.supportsSmartCharging === 'boolean'
            ? capabilities.supportsSmartCharging
            : false,
      },
    };
  }

  async logPayload(
    tenantId: string,
    vendorDeviceId: string,
    topic: string,
    payload: Prisma.InputJsonValue,
    normalizedEventType?: string,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.prisma.mqttVendorPayloadLog.create({
        data: {
          tenantId,
          vendorDeviceId,
          topic,
          payload,
          normalizedEventType,
          errorMessage,
          processedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to log payload for device ${vendorDeviceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
