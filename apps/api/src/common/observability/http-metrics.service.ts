import { Injectable } from '@nestjs/common';

type RouteMetric = {
  count: number;
  errors: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  samples: number[];
};

@Injectable()
export class HttpMetricsService {
  private readonly totals = {
    requests: 0,
    errors: 0,
  };

  private readonly statusClasses = new Map<string, number>();
  private readonly routes = new Map<string, RouteMetric>();
  private readonly maxRoutes = 1000;
  private readonly maxSamplesPerRoute = 1024;

  record(input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
      return;
    }

    this.totals.requests += 1;
    if (input.statusCode >= 500) {
      this.totals.errors += 1;
    }

    const statusClass = `${Math.floor(input.statusCode / 100)}xx`;
    this.statusClasses.set(
      statusClass,
      (this.statusClasses.get(statusClass) || 0) + 1,
    );

    const routeKey = `${input.method.toUpperCase()} ${input.route}`;
    let routeMetric = this.routes.get(routeKey);
    if (!routeMetric) {
      if (this.routes.size >= this.maxRoutes) {
        return;
      }
      routeMetric = {
        count: 0,
        errors: 0,
        sumMs: 0,
        minMs: input.durationMs,
        maxMs: input.durationMs,
        samples: [],
      };
      this.routes.set(routeKey, routeMetric);
    }

    routeMetric.count += 1;
    if (input.statusCode >= 500) {
      routeMetric.errors += 1;
    }
    routeMetric.sumMs += input.durationMs;
    routeMetric.minMs = Math.min(routeMetric.minMs, input.durationMs);
    routeMetric.maxMs = Math.max(routeMetric.maxMs, input.durationMs);
    routeMetric.samples.push(input.durationMs);

    if (routeMetric.samples.length > this.maxSamplesPerRoute) {
      routeMetric.samples.splice(
        0,
        routeMetric.samples.length - this.maxSamplesPerRoute,
      );
    }
  }

  snapshot() {
    const perRoute: Record<
      string,
      {
        count: number;
        errors: number;
        avgMs: number;
        minMs: number;
        maxMs: number;
        p95Ms: number;
      }
    > = {};

    for (const [key, value] of this.routes.entries()) {
      const sorted = [...value.samples].sort((a, b) => a - b);
      const p95Index =
        sorted.length === 0
          ? 0
          : Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      const p95Ms = sorted.length === 0 ? 0 : sorted[p95Index];

      perRoute[key] = {
        count: value.count,
        errors: value.errors,
        avgMs: value.count === 0 ? 0 : value.sumMs / value.count,
        minMs: value.minMs,
        maxMs: value.maxMs,
        p95Ms,
      };
    }

    return {
      totals: {
        requests: this.totals.requests,
        errors: this.totals.errors,
      },
      statusClasses: Object.fromEntries(this.statusClasses.entries()),
      routes: perRoute,
      generatedAt: new Date().toISOString(),
    };
  }
}
