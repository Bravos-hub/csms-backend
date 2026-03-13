import { IsIn, IsOptional, IsString } from 'class-validator';

export class OwnerDashboardQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '90d', 'YTD', 'ALL'])
  range?: '7d' | '30d' | '90d' | 'YTD' | 'ALL';

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsString()
  chargerType?: string;

  @IsOptional()
  @IsString()
  sessionStatus?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsIn(['previous', 'none'])
  compare?: 'previous' | 'none';
}

export type OwnerDashboardResponseDto = {
  filters: {
    range: '7d' | '30d' | '90d' | 'YTD' | 'ALL';
    compare: 'previous' | 'none';
    siteId: string | null;
    stationId: string | null;
    chargerType: string | null;
    sessionStatus: string | null;
    state: string | null;
  };
  kpis: {
    revenue: { value: number; deltaPct: number | null };
    energySoldKwh: { value: number; deltaPct: number | null };
    sessions: { value: number; deltaPct: number | null };
    utilizationPct: { value: number; deltaPct: number | null };
    uptimePct: { value: number | null; deltaPct: number | null };
    activeStations: { value: number; deltaPct: number | null };
    avgSessionDurationMinutes: {
      value: number | null;
      deltaPct: number | null;
    };
    margin: {
      value: number | null;
      deltaPct: number | null;
      available: boolean;
    };
  };
  commercial: {
    revenueCostMarginTrend: Array<{
      date: string;
      revenue: number;
      cost: number;
      margin: number | null;
    }>;
  };
  operations: {
    statusCounts: {
      total: number;
      online: number;
      offline: number;
      maintenance: number;
    };
    openIncidents: number;
    recurringFaultStations: number;
    downtimeHours: number | null;
    incidentSummary: Array<{
      stationId: string;
      stationName: string;
      openCount: number;
      recurringCount: number;
      highestSeverity: string;
    }>;
  };
  utilization: {
    heatmap: Array<{
      day: string;
      hour: number;
      utilizationPct: number;
      sessionCount: number;
      energyKwh: number;
    }>;
    topSites: Array<{
      stationId: string;
      stationName: string;
      siteId?: string | null;
      siteName?: string | null;
      revenue: number;
      sessions: number;
      utilizationPct: number;
      uptimePct: number | null;
      margin: number | null;
    }>;
    underperformingSites: Array<{
      stationId: string;
      stationName: string;
      siteId?: string | null;
      siteName?: string | null;
      revenue: number;
      sessions: number;
      utilizationPct: number;
      uptimePct: number | null;
      margin: number | null;
    }>;
  };
  alerts: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    reasonCode: string;
    targetType:
      | 'portfolio'
      | 'site'
      | 'station'
      | 'chargePoint'
      | 'incident'
      | 'session';
    targetId: string | null;
    recommendedPath: string;
  }>;
};
