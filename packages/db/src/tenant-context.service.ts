import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import {
  TenantRequestContext,
  TenantRoutingHint,
} from './tenant-routing.types';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantRequestContext>();

  run<T>(context: TenantRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): TenantRequestContext | undefined {
    return this.storage.getStore();
  }

  set(patch: Partial<TenantRequestContext>): TenantRequestContext {
    const current = this.storage.getStore();
    if (current) {
      Object.assign(current, patch);
      return current;
    }

    const next: TenantRequestContext = {
      ...patch,
    };
    this.storage.enterWith(next);
    return next;
  }

  runWithRouting<T>(
    routing: TenantRoutingHint | null,
    callback: () => Promise<T> | T,
  ): Promise<T> | T {
    const current = this.storage.getStore() || {};
    const next: TenantRequestContext = {
      ...current,
      routing,
      effectiveOrganizationId:
        routing?.organizationId || current.effectiveOrganizationId || null,
    };
    return this.storage.run(next, callback);
  }
}
