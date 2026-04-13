import { AnalyticsService } from './analytics-service.service';
import { HealthCheckService } from './health-check.service';
import { PrismaService } from '../../prisma.service';
import { TenantGuardrailsService } from '../../common/tenant/tenant-guardrails.service';

describe('AnalyticsService', () => {
  it('returns unknown uptime when charge point history is absent', () => {
    const service = new AnalyticsService(
      {} as unknown as HealthCheckService,
      {} as unknown as PrismaService,
      {} as unknown as TenantGuardrailsService,
    );

    const result = (
      service as unknown as {
        calculateChargePointUptime: (
          currentStatus: string,
          history: Array<{ status: string; timestamp: Date }>,
          start: Date,
          end: Date,
        ) => { uptimePct: number | null; downtimeHours: number | null };
      }
    ).calculateChargePointUptime(
      'AVAILABLE',
      [],
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T12:00:00.000Z'),
    );

    expect(result).toEqual({
      uptimePct: null,
      downtimeHours: null,
    });
  });
});
