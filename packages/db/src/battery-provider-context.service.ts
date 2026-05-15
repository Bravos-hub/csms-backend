import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface BatteryProviderScope {
  userId: string;
  tenantId: string;
  providerId: string;
  role: string;
  assignedStationIds: string[];
  assignedCabinetIds: string[];
}

@Injectable()
export class BatteryProviderContextService {
  private readonly storage = new AsyncLocalStorage<BatteryProviderScope>();

  run<T>(scope: BatteryProviderScope, callback: () => T): T {
    return this.storage.run(scope, callback);
  }

  get(): BatteryProviderScope | undefined {
    return this.storage.getStore();
  }

  set(patch: Partial<BatteryProviderScope>): BatteryProviderScope {
    const current = this.storage.getStore();
    if (!current) {
      throw new Error(
        'BatteryProviderContextService.set called outside of a scoped run',
      );
    }
    const updated = { ...current, ...patch };
    this.storage.enterWith(updated);
    return updated;
  }
}
