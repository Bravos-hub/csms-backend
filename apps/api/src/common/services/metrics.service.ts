import { Injectable, Logger } from '@nestjs/common';

export interface AuthMetric {
    operation: 'login' | 'logout' | 'refresh';
    success: boolean;
    duration: number;
    userId?: string;
    error?: string;
    timestamp: Date;
}

@Injectable()
export class MetricsService {
    private readonly logger = new Logger(MetricsService.name);
    private metrics: AuthMetric[] = [];
    private readonly MAX_METRICS = 10000; // Keep last 10k metrics in memory

    recordAuthMetric(metric: AuthMetric) {
        this.metrics.push(metric);

        // Keep only last MAX_METRICS
        if (this.metrics.length > this.MAX_METRICS) {
            this.metrics = this.metrics.slice(-this.MAX_METRICS);
        }

        // Log important events
        const status = metric.success ? 'SUCCESS' : 'FAILED';
        this.logger.log(
            `[${metric.operation.toUpperCase()}] ${status} - ` +
            `Duration: ${metric.duration}ms` +
            (metric.userId ? ` - UserId: ${metric.userId}` : '') +
            (metric.error ? ` - Error: ${metric.error}` : ''),
        );
    }

    getMetricsSummary(timeWindowMinutes = 60) {
        const now = new Date();
        const windowStart = new Date(now.getTime() - timeWindowMinutes * 60 * 1000);

        const recentMetrics = this.metrics.filter((m) => m.timestamp > windowStart);

        return {
            timeWindow: `Last ${timeWindowMinutes} minutes`,
            total: recentMetrics.length,
            byOperation: {
                login: recentMetrics.filter((m) => m.operation === 'login').length,
                logout: recentMetrics.filter((m) => m.operation === 'logout').length,
                refresh: recentMetrics.filter((m) => m.operation === 'refresh').length,
            },
            successRate: {
                login: this.calculateSuccessRate(recentMetrics, 'login'),
                logout: this.calculateSuccessRate(recentMetrics, 'logout'),
                refresh: this.calculateSuccessRate(recentMetrics, 'refresh'),
            },
            averageDuration: {
                login: this.calculateAverageDuration(recentMetrics, 'login'),
                logout: this.calculateAverageDuration(recentMetrics, 'logout'),
                refresh: this.calculateAverageDuration(recentMetrics, 'refresh'),
            },
            failureReasons: this.getFailureReasons(recentMetrics),
        };
    }

    private calculateSuccessRate(
        metrics: AuthMetric[],
        operation: string,
    ): number {
        const filtered = metrics.filter((m) => m.operation === operation);
        if (filtered.length === 0) return 100;
        const successful = filtered.filter((m) => m.success).length;
        return Math.round((successful / filtered.length) * 100);
    }

    private calculateAverageDuration(
        metrics: AuthMetric[],
        operation: string,
    ): number {
        const filtered = metrics.filter((m) => m.operation === operation);
        if (filtered.length === 0) return 0;
        const total = filtered.reduce((sum, m) => sum + m.duration, 0);
        return Math.round(total / filtered.length);
    }

    private getFailureReasons(metrics: AuthMetric[]): Record<string, number> {
        const failures = metrics.filter((m) => !m.success && m.error);
        const reasons: Record<string, number> = {};

        failures.forEach((f) => {
            const error = f.error || 'Unknown';
            reasons[error] = (reasons[error] || 0) + 1;
        });

        return reasons;
    }

    // Clear old metrics (can be called periodically)
    clearOldMetrics() {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const beforeCount = this.metrics.length;
        this.metrics = this.metrics.filter((m) => m.timestamp > oneHourAgo);
        const removed = beforeCount - this.metrics.length;

        if (removed > 0) {
            this.logger.log(`Cleared ${removed} old metrics`);
        }
    }
}
