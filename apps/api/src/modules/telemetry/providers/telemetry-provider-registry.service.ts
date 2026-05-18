import { Injectable, Logger } from '@nestjs/common';
import {
  TelemetryProvider,
  VehicleTelemetryProviderAdapter,
} from '../telemetry.types';

@Injectable()
export class TelemetryProviderRegistryService {
  private readonly adapters = new Map<
    TelemetryProvider,
    VehicleTelemetryProviderAdapter
  >();
  private readonly logger = new Logger(TelemetryProviderRegistryService.name);

  register(adapter: VehicleTelemetryProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter);
    this.logger.log(
      `Registered telemetry provider adapter: ${adapter.provider}`,
    );
  }

  resolve(
    provider: TelemetryProvider,
  ): VehicleTelemetryProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  has(provider: TelemetryProvider): boolean {
    return this.adapters.has(provider);
  }

  list(): Array<{
    provider: TelemetryProvider;
    supportsCommands: boolean;
    supportsWebhooks: boolean;
  }> {
    return Array.from(this.adapters.values()).map((a) => ({
      provider: a.provider,
      supportsCommands: typeof a.sendCommand === 'function',
      supportsWebhooks:
        typeof a.verifyWebhook === 'function' &&
        typeof a.ingestWebhook === 'function',
    }));
  }
}
