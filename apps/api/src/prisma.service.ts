/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  TenantContextService,
  TenantPrismaRoutingService,
  TenantRoutingHint,
} from '@app/db';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly localProperties = new Set<string>([
    'onModuleInit',
    'onModuleDestroy',
    'getPoolMetrics',
    'getRoutingMetrics',
    'getControlPlaneClient',
    'runWithTenantRouting',
  ]);

  constructor(
    private readonly tenantRouting: TenantPrismaRoutingService,
    private readonly tenantContext: TenantContextService,
  ) {
    return new Proxy(this, {
      get: (target, prop, receiver) => target.resolveProxyValue(prop, receiver),
    }) as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.tenantRouting.connectShared();
  }

  async onModuleDestroy(): Promise<void> {
    await this.tenantRouting.shutdown();
  }

  getPoolMetrics(): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
    max: number | null;
  } {
    return this.tenantRouting.getPoolMetrics().shared;
  }

  getRoutingMetrics() {
    return this.tenantRouting.getRoutingMetrics();
  }

  getControlPlaneClient(): PrismaClient {
    return this.tenantRouting.getSharedClient();
  }

  runWithTenantRouting<T>(
    routing: TenantRoutingHint | null,
    callback: () => Promise<T> | T,
  ): Promise<T> | T {
    return this.tenantContext.runWithRouting(routing, callback);
  }

  private resolveProxyValue(prop: string | symbol, receiver: unknown): unknown {
    if (
      typeof prop === 'symbol' ||
      this.localProperties.has(String(prop)) ||
      Reflect.has(this, prop)
    ) {
      const localValue: unknown = Reflect.get(this, prop, receiver);
      return this.bindIfFunction(localValue, this);
    }

    const client = this.resolveClientForCurrentContext();
    const clientObject = client as unknown as Record<PropertyKey, unknown>;
    const value: unknown = Reflect.get(clientObject, prop);
    return this.bindIfFunction(value, client);
  }

  private resolveClientForCurrentContext(): PrismaClient {
    const context = this.tenantContext.get();
    return this.tenantRouting.getClientForRouting(context?.routing);
  }

  private bindIfFunction(value: unknown, thisArg: unknown): unknown {
    if (typeof value !== 'function') {
      return value;
    }

    const callable = value as (...args: unknown[]) => unknown;
    return callable.bind(thisArg);
  }
}

export interface PrismaService extends PrismaClient {
  readonly __tenantPrismaProxyBrand?: never;
}
