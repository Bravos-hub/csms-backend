import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export type AuthMonitoringContext = {
  route: string;
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  identifier?: string;
};

type SlidingWindowState = {
  events: number[];
  lastSeenAt: number;
};

@Injectable()
export class AuthAnomalyMonitorService {
  private readonly logger = new Logger(AuthAnomalyMonitorService.name);
  private readonly windowMs = 10 * 60 * 1000;
  private readonly cleanupAfterMs = 60 * 60 * 1000;
  private readonly thresholds = {
    ip: 20,
    device: 12,
    identifier: 8,
  } as const;

  private readonly outcomes = new Map<
    string,
    { success: number; failure: number }
  >();
  private readonly anomalyTotals = {
    ip: 0,
    device: 0,
    identifier: 0,
  };
  private readonly failureByIp = new Map<string, SlidingWindowState>();
  private readonly failureByDevice = new Map<string, SlidingWindowState>();
  private readonly failureByIdentifier = new Map<string, SlidingWindowState>();
  private readonly seenAnomalyKeys = new Map<string, number>();

  recordSuccess(context: AuthMonitoringContext): void {
    this.recordOutcome(context.route, true);
    this.performPeriodicCleanup();
  }

  recordFailure(context: AuthMonitoringContext, reason?: string): void {
    const now = Date.now();
    this.recordOutcome(context.route, false);
    this.performPeriodicCleanup(now);

    const ip = this.normalize(context.ip);
    const device = this.normalize(context.deviceId);
    const identifierHash = context.identifier
      ? this.hashIdentifier(context.identifier)
      : undefined;

    if (ip) {
      const count = this.recordWindowEvent(this.failureByIp, ip, now);
      if (count >= this.thresholds.ip) {
        this.raiseAnomaly('ip', ip, count, context, reason, now);
      }
    }

    if (device) {
      const count = this.recordWindowEvent(this.failureByDevice, device, now);
      if (count >= this.thresholds.device) {
        this.raiseAnomaly('device', device, count, context, reason, now);
      }
    }

    if (identifierHash) {
      const count = this.recordWindowEvent(
        this.failureByIdentifier,
        identifierHash,
        now,
      );
      if (count >= this.thresholds.identifier) {
        this.raiseAnomaly(
          'identifier',
          identifierHash,
          count,
          context,
          reason,
          now,
        );
      }
    }
  }

  getSummary() {
    const perRoute = Object.fromEntries(this.outcomes.entries());
    return {
      status: 'ok',
      windowMs: this.windowMs,
      thresholds: this.thresholds,
      anomalyTotals: this.anomalyTotals,
      trackedSets: {
        ip: this.failureByIp.size,
        device: this.failureByDevice.size,
        identifier: this.failureByIdentifier.size,
      },
      perRoute,
      generatedAt: new Date().toISOString(),
    };
  }

  private recordOutcome(route: string, success: boolean) {
    const key = route || 'unknown';
    const current = this.outcomes.get(key) || { success: 0, failure: 0 };
    if (success) {
      current.success += 1;
    } else {
      current.failure += 1;
    }
    this.outcomes.set(key, current);
  }

  private recordWindowEvent(
    map: Map<string, SlidingWindowState>,
    key: string,
    now: number,
  ): number {
    const existing = map.get(key) || { events: [], lastSeenAt: now };
    const cutoff = now - this.windowMs;
    existing.events = existing.events.filter(
      (timestamp) => timestamp >= cutoff,
    );
    existing.events.push(now);
    existing.lastSeenAt = now;
    map.set(key, existing);
    return existing.events.length;
  }

  private raiseAnomaly(
    dimension: 'ip' | 'device' | 'identifier',
    key: string,
    count: number,
    context: AuthMonitoringContext,
    reason: string | undefined,
    now: number,
  ) {
    const anomalyKey = `${dimension}:${key}`;
    const seenAt = this.seenAnomalyKeys.get(anomalyKey);
    if (seenAt && now - seenAt < this.windowMs) {
      return;
    }

    this.seenAnomalyKeys.set(anomalyKey, now);
    this.anomalyTotals[dimension] += 1;

    const payload = {
      event: 'auth_anomaly_detected',
      dimension,
      route: context.route,
      ip: context.ip,
      deviceId: context.deviceId,
      identifierHash: context.identifier
        ? this.hashIdentifier(context.identifier)
        : undefined,
      countInWindow: count,
      windowMs: this.windowMs,
      reason: reason || undefined,
      userAgent: context.userAgent,
      time: new Date(now).toISOString(),
    };

    this.logger.warn(JSON.stringify(payload));
  }

  private performPeriodicCleanup(now = Date.now()) {
    this.pruneWindowMap(this.failureByIp, now);
    this.pruneWindowMap(this.failureByDevice, now);
    this.pruneWindowMap(this.failureByIdentifier, now);

    const anomalyCutoff = now - this.cleanupAfterMs;
    for (const [key, seenAt] of this.seenAnomalyKeys.entries()) {
      if (seenAt < anomalyCutoff) {
        this.seenAnomalyKeys.delete(key);
      }
    }
  }

  private pruneWindowMap(map: Map<string, SlidingWindowState>, now: number) {
    const cutoff = now - this.windowMs;
    const staleCutoff = now - this.cleanupAfterMs;
    for (const [key, state] of map.entries()) {
      state.events = state.events.filter((timestamp) => timestamp >= cutoff);
      if (state.events.length === 0 && state.lastSeenAt < staleCutoff) {
        map.delete(key);
      } else {
        map.set(key, state);
      }
    }
  }

  private normalize(value?: string): string | undefined {
    if (!value) return undefined;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private hashIdentifier(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
}
