import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';

const RETRY_INTERVAL_MS = 10_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function normalizeEvents(events: string[] | string): string[] {
  if (Array.isArray(events)) {
    return Array.from(new Set(events.map((item) => item.trim()).filter(Boolean)));
  }
  return Array.from(
    new Set(
      String(events || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private retryTimer: NodeJS.Timeout | null = null;
  private retryRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  onModuleInit(): void {
    this.retryTimer = setInterval(() => {
      void this.retryPendingDeliveries();
    }, RETRY_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private resolveTenantId(): string | null {
    const context = this.tenantContext.get();
    return context?.effectiveOrganizationId || context?.authenticatedOrganizationId || null;
  }

  async listWebhooks() {
    const organizationId = this.resolveTenantId();
    return this.prisma.webhook.findMany({
      where: organizationId ? { organizationId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getWebhookById(id: string) {
    const organizationId = this.resolveTenantId();
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) return null;
    if (organizationId && webhook.organizationId !== organizationId) return null;
    return webhook;
  }

  async listDeliveries(webhookId: string, limit = 50) {
    const webhook = await this.getWebhookById(webhookId);
    if (!webhook) return [];

    return this.prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Math.floor(limit) || 50, 1), 200),
    });
  }

  async createWebhook(payload: Record<string, unknown>) {
    const organizationId = this.resolveTenantId();
    const events = normalizeEvents(payload.events as string[] | string);

    return this.prisma.webhook.create({
      data: {
        organizationId,
        url: String(payload.url || '').trim(),
        events: events.join(','),
        active: payload.active !== false,
        secret:
          typeof payload.secret === 'string' && payload.secret.trim().length > 0
            ? payload.secret.trim()
            : randomUUID(),
        timeoutMs:
          typeof payload.timeoutMs === 'number' && Number.isFinite(payload.timeoutMs)
            ? Math.max(1000, Math.floor(payload.timeoutMs))
            : 5000,
        maxRetries:
          typeof payload.maxRetries === 'number' && Number.isFinite(payload.maxRetries)
            ? Math.max(0, Math.floor(payload.maxRetries))
            : 3,
      },
    });
  }

  async updateWebhook(id: string, payload: Record<string, unknown>) {
    const webhook = await this.getWebhookById(id);
    if (!webhook) return null;

    const updates: Record<string, unknown> = {};
    if (payload.url !== undefined) {
      updates.url = String(payload.url || '').trim();
    }
    if (payload.events !== undefined) {
      updates.events = normalizeEvents(payload.events as string[] | string).join(',');
    }
    if (payload.active !== undefined) {
      updates.active = payload.active === true;
    }
    if (payload.secret !== undefined && typeof payload.secret === 'string') {
      updates.secret = payload.secret.trim().length > 0 ? payload.secret.trim() : null;
    }
    if (payload.timeoutMs !== undefined && typeof payload.timeoutMs === 'number') {
      updates.timeoutMs = Math.max(1000, Math.floor(payload.timeoutMs));
    }
    if (payload.maxRetries !== undefined && typeof payload.maxRetries === 'number') {
      updates.maxRetries = Math.max(0, Math.floor(payload.maxRetries));
    }

    return this.prisma.webhook.update({ where: { id }, data: updates });
  }

  async removeWebhook(id: string) {
    const webhook = await this.getWebhookById(id);
    if (!webhook) return null;
    await this.prisma.webhook.delete({ where: { id } });
    return { ok: true };
  }

  async testWebhook(id: string) {
    const webhook = await this.getWebhookById(id);
    if (!webhook) return null;

    await this.dispatchEvent('webhook.test', {
      webhookId: webhook.id,
      timestamp: new Date().toISOString(),
      probe: true,
    }, webhook.organizationId || undefined);

    return { success: true, id: webhook.id };
  }

  async dispatchEvent(
    eventType: string,
    payload: Record<string, unknown>,
    organizationId?: string,
  ) {
    const hooks = await this.prisma.webhook.findMany({
      where: {
        active: true,
        ...(organizationId
          ? {
              OR: [
                { organizationId: organizationId },
                { organizationId: null },
              ],
            }
          : {}),
      },
    });

    const matchingHooks = hooks.filter((hook) => {
      const subscribed = normalizeEvents(hook.events);
      return subscribed.includes('*') || subscribed.includes(eventType);
    });

    if (!matchingHooks.length) return { delivered: 0 };

    const deliveryIds: string[] = [];
    for (const hook of matchingHooks) {
      const created = await this.prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          eventType,
          payload: toInputJsonValue(payload),
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      });
      deliveryIds.push(created.id);
    }

    for (const deliveryId of deliveryIds) {
      await this.processDelivery(deliveryId);
    }

    return { delivered: deliveryIds.length };
  }

  private async retryPendingDeliveries() {
    if (this.retryRunning) return;
    this.retryRunning = true;

    try {
      const due = await this.prisma.webhookDelivery.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      for (const delivery of due) {
        await this.processDelivery(delivery.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Webhook retry cycle failed: ${message}`);
    } finally {
      this.retryRunning = false;
    }
  }

  private async processDelivery(deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery || !delivery.webhook.active) return;

    const hook = delivery.webhook;
    const maxRetries = typeof hook.maxRetries === 'number' ? hook.maxRetries : 3;
    const nextAttempt = delivery.attempts + 1;

    const signatureBase = JSON.stringify({
      id: delivery.id,
      eventType: delivery.eventType,
      payload: delivery.payload,
    });

    const signature = hook.secret
      ? createHmac('sha256', hook.secret).update(signatureBase).digest('hex')
      : null;

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let status: 'SUCCESS' | 'FAILED' | 'DEAD_LETTER' = 'FAILED';
    let lastError: string | null = null;

    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EVZONE-Event': delivery.eventType,
          'X-EVZONE-Delivery-Id': delivery.id,
          ...(signature ? { 'X-EVZONE-Signature': signature } : {}),
        },
        body: JSON.stringify({
          id: delivery.id,
          eventType: delivery.eventType,
          timestamp: new Date().toISOString(),
          payload: asRecord(delivery.payload),
        }),
        signal: AbortSignal.timeout(Math.max(1000, hook.timeoutMs || 5000)),
      });

      responseStatus = response.status;
      responseBody = await response.text();
      status = response.ok ? 'SUCCESS' : nextAttempt > maxRetries ? 'DEAD_LETTER' : 'FAILED';
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      status = nextAttempt > maxRetries ? 'DEAD_LETTER' : 'FAILED';
    }

    const nextDelayMs = Math.min(300_000, 5_000 * Math.pow(2, Math.max(0, nextAttempt - 1)));

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts: nextAttempt,
        status,
        deliveredAt: status === 'SUCCESS' ? new Date() : null,
        lastError,
        responseStatus,
        responseBody,
        nextAttemptAt:
          status === 'FAILED'
            ? new Date(Date.now() + nextDelayMs)
            : null,
      },
    });
  }
}
