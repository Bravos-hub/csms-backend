import { Injectable } from '@nestjs/common';

type LatencyEntry = {
  count: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  samples: number[];
};

@Injectable()
export class WorkerMetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly latencies = new Map<string, LatencyEntry>();
  private readonly maxSamplesPerMetric = 4096;

  increment(name: string, amount = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + amount);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observeLatency(name: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    const existing = this.latencies.get(name) || {
      count: 0,
      sumMs: 0,
      minMs: durationMs,
      maxMs: durationMs,
      samples: [],
    };

    existing.count += 1;
    existing.sumMs += durationMs;
    existing.minMs = Math.min(existing.minMs, durationMs);
    existing.maxMs = Math.max(existing.maxMs, durationMs);
    existing.samples.push(durationMs);

    if (existing.samples.length > this.maxSamplesPerMetric) {
      existing.samples.splice(
        0,
        existing.samples.length - this.maxSamplesPerMetric,
      );
    }

    this.latencies.set(name, existing);
  }

  snapshot() {
    const counters = Object.fromEntries(this.counters.entries());
    const gauges = Object.fromEntries(this.gauges.entries());

    const latencies: Record<
      string,
      {
        count: number;
        avgMs: number;
        minMs: number;
        maxMs: number;
        p95Ms: number;
      }
    > = {};

    for (const [name, entry] of this.latencies.entries()) {
      const sorted = [...entry.samples].sort((a, b) => a - b);
      const p95Index =
        sorted.length === 0
          ? 0
          : Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      const p95Ms = sorted.length === 0 ? 0 : sorted[p95Index];

      latencies[name] = {
        count: entry.count,
        avgMs: entry.count > 0 ? entry.sumMs / entry.count : 0,
        minMs: entry.minMs,
        maxMs: entry.maxMs,
        p95Ms,
      };
    }

    return {
      counters,
      gauges,
      latencies,
      generatedAt: new Date().toISOString(),
    };
  }
}
