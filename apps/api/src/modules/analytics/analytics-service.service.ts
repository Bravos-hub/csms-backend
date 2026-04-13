import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HealthCheckService } from './health-check.service';
import { PrismaService } from '../../prisma.service';
import type {
  OwnerDashboardQueryDto,
  OwnerDashboardResponseDto,
} from './dto/owner-dashboard.dto';
import {
  TenantGuardrailsService,
  TenantScope,
} from '../../common/tenant/tenant-guardrails.service';

type Actor = {
  sub?: string;
  role?: string;
  organizationId?: string;
  orgId?: string;
};

type StationSnapshot = {
  id: string;
  name: string;
  status: string;
  orgId: string | null;
  siteId: string | null;
  siteName: string | null;
  chargePoints: Array<{
    id: string;
    status: string;
    type: string;
    power: number;
    statusHistory: Array<{
      status: string;
      timestamp: Date;
    }>;
  }>;
};

type SessionSnapshot = {
  id: string;
  stationId: string;
  startTime: Date;
  endTime: Date | null;
  totalEnergy: number;
  amount: number;
  status: string;
  chargePoint: {
    id: string;
    type: string;
  } | null;
  receiptTransactions: Array<{
    id: string;
    total: number;
    energyCost: number;
    taxes: number;
    createdAt: Date;
  }>;
};

type RangeWindow = {
  range: '7d' | '30d' | '90d' | 'YTD' | 'ALL';
  compare: 'previous' | 'none';
  start: Date;
  end: Date;
  previousStart: Date | null;
  previousEnd: Date | null;
};

type StationMetric = {
  stationId: string;
  stationName: string;
  siteId: string | null;
  siteName: string | null;
  revenue: number;
  sessions: number;
  utilizationPct: number;
  uptimePct: number | null;
  margin: number | null;
  score: number;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HEATMAP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const ALERT_OFFLINE_THRESHOLD_HOURS = 2;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly healthCheck: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly tenantGuardrails: TenantGuardrailsService,
  ) {}

  private async requireChargeScope(): Promise<TenantScope> {
    return this.tenantGuardrails.requireTenantScope('charge');
  }

  getHello(): string {
    return 'Analytics Service Operational';
  }

  async getDashboard(period: string): Promise<Record<string, unknown>> {
    const scope = await this.requireChargeScope();
    const now = new Date();
    const startOfDay = this.startOfDay(now);
    const startOf24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startOf7d = new Date(startOfDay);
    startOf7d.setDate(startOf7d.getDate() - 6);
    const stations = await this.prisma.station.findMany({
      where: this.tenantGuardrails.buildOwnedStationWhere(scope),
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
    const stationIds = stations.map((station) => station.id);

    const [
      chargePoints,
      todaySessionsAggregate,
      activeSessionsCount,
      incidents24hCount,
      sessionsLast7Days,
    ] = await Promise.all([
      this.prisma.chargePoint.findMany({
        where: {
          stationId: { in: stationIds },
        },
        select: {
          id: true,
          stationId: true,
          status: true,
          power: true,
        },
      }),
      this.prisma.session.aggregate({
        where: {
          stationId: { in: stationIds },
          startTime: {
            gte: startOfDay,
          },
        },
        _count: {
          _all: true,
        },
        _sum: {
          amount: true,
          totalEnergy: true,
        },
      }),
      this.prisma.session.count({
        where: {
          stationId: { in: stationIds },
          status: {
            in: ['ACTIVE', 'IN_PROGRESS'],
          },
        },
      }),
      this.prisma.incident.count({
        where: {
          stationId: { in: stationIds },
          createdAt: {
            gte: startOf24h,
          },
        },
      }),
      this.prisma.session.findMany({
        where: {
          stationId: { in: stationIds },
          startTime: {
            gte: startOf7d,
          },
        },
        select: {
          stationId: true,
          startTime: true,
          amount: true,
        },
      }),
    ]);

    let onlineStations = 0;
    let maintenanceStations = 0;
    let offlineStations = 0;

    const stationStatusById = new Map<
      string,
      'online' | 'maintenance' | 'offline'
    >();
    const stationNameById = new Map<string, string>();

    for (const station of stations) {
      const statusBucket = this.resolveStationStatusBucket(station.status);
      stationStatusById.set(station.id, statusBucket);
      stationNameById.set(station.id, station.name);

      if (statusBucket === 'online') {
        onlineStations += 1;
      } else if (statusBucket === 'maintenance') {
        maintenanceStations += 1;
      } else {
        offlineStations += 1;
      }
    }

    let onlineChargers = 0;
    let totalPower = 0;
    for (const cp of chargePoints) {
      if (this.isChargePointOnline(cp.status)) {
        onlineChargers += 1;
        totalPower += cp.power || 0;
      }
    }

    const sessionsByDate = new Map<string, number>();
    const revenueByDate = new Map<string, number>();
    const sessionsByHour = new Map<number, number>();
    const stationRollup = new Map<
      string,
      { sessions: number; revenue: number }
    >();

    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(startOfDay);
      date.setDate(startOfDay.getDate() - i);
      const key = this.toDateKey(date);
      sessionsByDate.set(key, 0);
      revenueByDate.set(key, 0);
    }

    for (const session of sessionsLast7Days) {
      const key = this.toDateKey(session.startTime);
      sessionsByDate.set(key, (sessionsByDate.get(key) || 0) + 1);
      revenueByDate.set(
        key,
        (revenueByDate.get(key) || 0) + (session.amount || 0),
      );

      if (session.startTime >= startOf24h) {
        const hour = session.startTime.getHours();
        sessionsByHour.set(hour, (sessionsByHour.get(hour) || 0) + 1);
      }

      const current = stationRollup.get(session.stationId) || {
        sessions: 0,
        revenue: 0,
      };
      current.sessions += 1;
      current.revenue += session.amount || 0;
      stationRollup.set(session.stationId, current);
    }

    const revenueTrend = Array.from(revenueByDate.entries()).map(
      ([date, revenue]) => ({
        date,
        revenue: Number(revenue.toFixed(2)),
        cost: 0,
      }),
    );

    const utilizationTrend = Array.from({ length: 24 }, (_, hour) => {
      const sessionsForHour = sessionsByHour.get(hour) || 0;
      const utilization =
        stations.length > 0
          ? Math.min(100, Math.round((sessionsForHour / stations.length) * 100))
          : 0;

      return {
        hour,
        day: 'Today',
        utilization,
      };
    });

    const topStations = Array.from(stationRollup.entries())
      .map(([stationId, metrics]) => ({
        stationId,
        stationName: stationNameById.get(stationId) || stationId,
        sessions: metrics.sessions,
        revenue: Number(metrics.revenue.toFixed(2)),
        uptime: this.stationStatusToUptime(
          stationStatusById.get(stationId) || 'offline',
        ),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const todaySessions = todaySessionsAggregate._count._all || 0;
    const todayRevenue = Number(
      (todaySessionsAggregate._sum.amount || 0).toFixed(2),
    );
    const todayEnergy = Number(
      (todaySessionsAggregate._sum.totalEnergy || 0).toFixed(2),
    );

    const totalStations = stations.length;
    const utilizationPercent =
      totalStations > 0
        ? Math.round((activeSessionsCount / totalStations) * 100)
        : 0;

    return {
      period,
      totalEnergy: todayEnergy,
      totalSessions: todaySessions,
      revenue: todayRevenue,
      activeChargers: onlineChargers,
      utilization: utilizationPercent,
      realTime: {
        activeSessions: activeSessionsCount,
        onlineChargers,
        totalPower: Number(totalPower.toFixed(2)),
        currentRevenue: todayRevenue,
      },
      today: {
        sessions: todaySessions,
        energyDelivered: todayEnergy,
        revenue: todayRevenue,
        incidents: incidents24hCount,
      },
      chargers: {
        total: totalStations,
        online: onlineStations,
        offline: offlineStations,
        maintenance: maintenanceStations,
      },
      trends: {
        revenue: revenueTrend,
        utilization: utilizationTrend,
        topStations,
      },
      incidents24h: incidents24hCount,
    };
  }

  async getOwnerDashboard(
    query: OwnerDashboardQueryDto,
    actor?: Actor,
  ): Promise<OwnerDashboardResponseDto> {
    const scope = await this.requireChargeScope();
    const scopeOrgId = scope.tenantId;
    const actorId = actor?.sub || null;
    if (!scopeOrgId && !actorId) {
      throw new ForbiddenException(
        'Owner analytics requires authenticated scope',
      );
    }

    const window = this.resolveWindow(query);
    const stationWhere = this.tenantGuardrails.buildOwnedStationWhere(
      scope,
      this.buildOwnerStationWhere(query, scopeOrgId, actorId),
    );

    const ownedStations = (await this.prisma.station.findMany({
      where: stationWhere,
      select: {
        id: true,
        name: true,
        status: true,
        orgId: true,
        siteId: true,
        site: { select: { id: true, name: true } },
        chargePoints: {
          select: {
            id: true,
            status: true,
            type: true,
            power: true,
            statusHistory: {
              where: {
                timestamp: {
                  lte: window.end,
                },
              },
              orderBy: {
                timestamp: 'asc',
              },
              select: {
                status: true,
                timestamp: true,
              },
            },
          },
        },
      },
    })) as unknown as Array<
      Omit<StationSnapshot, 'siteName'> & {
        site: { id: string; name: string } | null;
      }
    >;

    const stationSnapshots: StationSnapshot[] = ownedStations.map(
      (station) => ({
        id: station.id,
        name: station.name,
        status: station.status,
        orgId: station.orgId,
        siteId: station.siteId,
        siteName: station.site?.name || null,
        chargePoints: station.chargePoints,
      }),
    );

    const stationIds = stationSnapshots.map((station) => station.id);
    if (stationIds.length === 0) {
      return this.emptyOwnerDashboard(window, query);
    }

    const sessionWhere = this.buildOwnerSessionWhere(
      query,
      stationIds,
      window.start,
      window.end,
    );
    const previousSessionWhere =
      window.previousStart && window.previousEnd
        ? this.buildOwnerSessionWhere(
            query,
            stationIds,
            window.previousStart,
            window.previousEnd,
          )
        : null;

    const [currentSessionsRaw, previousSessionsRaw, incidents] =
      await Promise.all([
        this.prisma.session.findMany({
          where: sessionWhere,
          include: {
            chargePoint: {
              select: {
                id: true,
                type: true,
              },
            },
            receiptTransactions: {
              select: {
                id: true,
                total: true,
                energyCost: true,
                taxes: true,
                createdAt: true,
              },
            },
          },
        }),
        previousSessionWhere
          ? this.prisma.session.findMany({
              where: previousSessionWhere,
              include: {
                chargePoint: {
                  select: {
                    id: true,
                    type: true,
                  },
                },
                receiptTransactions: {
                  select: {
                    id: true,
                    total: true,
                    energyCost: true,
                    taxes: true,
                    createdAt: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
        this.prisma.incident.findMany({
          where: {
            stationId: { in: stationIds },
          },
          select: {
            id: true,
            stationId: true,
            chargePointId: true,
            title: true,
            severity: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

    const currentSessions = currentSessionsRaw as unknown as SessionSnapshot[];
    const previousSessions =
      previousSessionsRaw as unknown as SessionSnapshot[];

    const uptimeByChargePoint = new Map<
      string,
      { uptimePct: number | null; downtimeHours: number | null }
    >();
    for (const station of stationSnapshots) {
      for (const chargePoint of station.chargePoints) {
        uptimeByChargePoint.set(
          chargePoint.id,
          this.calculateChargePointUptime(
            chargePoint.status,
            chargePoint.statusHistory,
            window.start,
            window.end,
          ),
        );
      }
    }

    const currentAgg = this.aggregateOwnerMetrics(
      stationSnapshots,
      currentSessions,
      incidents,
      uptimeByChargePoint,
    );
    const previousAgg = this.aggregateOwnerMetrics(
      stationSnapshots,
      previousSessions,
      incidents,
      uptimeByChargePoint,
    );

    return {
      filters: {
        range: window.range,
        compare: window.compare,
        siteId: query.siteId || null,
        stationId: query.stationId || null,
        chargerType: query.chargerType || null,
        sessionStatus: query.sessionStatus || null,
        state: query.state || null,
      },
      kpis: {
        revenue: {
          value: currentAgg.revenue,
          deltaPct: this.percentDelta(currentAgg.revenue, previousAgg.revenue),
        },
        energySoldKwh: {
          value: currentAgg.energySoldKwh,
          deltaPct: this.percentDelta(
            currentAgg.energySoldKwh,
            previousAgg.energySoldKwh,
          ),
        },
        sessions: {
          value: currentAgg.sessions,
          deltaPct: this.percentDelta(
            currentAgg.sessions,
            previousAgg.sessions,
          ),
        },
        utilizationPct: {
          value: currentAgg.utilizationPct,
          deltaPct: this.percentDelta(
            currentAgg.utilizationPct,
            previousAgg.utilizationPct,
          ),
        },
        uptimePct: {
          value: currentAgg.uptimePct,
          deltaPct: this.percentDeltaNullable(
            currentAgg.uptimePct,
            previousAgg.uptimePct,
          ),
        },
        activeStations: {
          value: currentAgg.activeStations,
          deltaPct: this.percentDelta(
            currentAgg.activeStations,
            previousAgg.activeStations,
          ),
        },
        avgSessionDurationMinutes: {
          value: currentAgg.avgSessionDurationMinutes,
          deltaPct: this.percentDeltaNullable(
            currentAgg.avgSessionDurationMinutes,
            previousAgg.avgSessionDurationMinutes,
          ),
        },
        margin: {
          value: currentAgg.marginValue,
          deltaPct: this.percentDeltaNullable(
            currentAgg.marginValue,
            previousAgg.marginValue,
          ),
          available: currentAgg.marginValue != null,
        },
      },
      commercial: {
        revenueCostMarginTrend: currentAgg.revenueTrend,
      },
      operations: {
        statusCounts: currentAgg.statusCounts,
        openIncidents: currentAgg.openIncidents,
        recurringFaultStations: currentAgg.recurringFaultStations,
        downtimeHours: currentAgg.downtimeHours,
        incidentSummary: currentAgg.incidentSummary,
      },
      utilization: {
        heatmap: currentAgg.heatmap,
        topSites: currentAgg.topStations,
        underperformingSites: currentAgg.bottomStations,
      },
      alerts: this.buildOwnerAlerts({
        stations: stationSnapshots,
        current: currentAgg,
        previous: previousAgg,
        currentSessions,
        incidents,
        end: window.end,
      }),
    };
  }

  async getUptime(stationId?: string): Promise<Record<string, unknown>> {
    const scope = await this.requireChargeScope();
    if (stationId) {
      const station = await this.prisma.station.findFirst({
        where: this.tenantGuardrails.buildOwnedStationWhere(scope, {
          id: stationId,
        }),
        select: { status: true },
      });
      const bucket = this.resolveStationStatusBucket(station?.status);
      const uptime = this.stationStatusToUptime(bucket);
      return {
        uptime,
        downtime: Number((100 - uptime).toFixed(2)),
        lastOutage: null,
      };
    }

    const stations = await this.prisma.station.findMany({
      where: this.tenantGuardrails.buildOwnedStationWhere(scope),
      select: { status: true },
    });
    const total = stations.length;
    const online = stations.filter(
      (station) => this.resolveStationStatusBucket(station.status) === 'online',
    ).length;
    const uptime = total > 0 ? Number(((online / total) * 100).toFixed(2)) : 0;

    return {
      uptime,
      downtime: Number((100 - uptime).toFixed(2)),
      lastOutage: null,
    };
  }

  async getUsage(): Promise<Record<string, unknown>> {
    const scope = await this.requireChargeScope();
    const stationIds = await this.tenantGuardrails.listOwnedStationIds(scope);
    const now = new Date();
    const startOfDay = this.startOfDay(now);
    const startOf7d = new Date(startOfDay);
    startOf7d.setDate(startOf7d.getDate() - 6);

    const sessions = await this.prisma.session.findMany({
      where: {
        stationId: { in: stationIds },
        startTime: {
          gte: startOf7d,
        },
      },
      select: {
        startTime: true,
      },
    });

    const labels: string[] = [];
    const countsByDate = new Map<string, number>();
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(startOfDay);
      date.setDate(startOfDay.getDate() - i);
      const key = this.toDateKey(date);
      labels.push(date.toLocaleDateString('en-GB', { weekday: 'short' }));
      countsByDate.set(key, 0);
    }

    for (const session of sessions) {
      const key = this.toDateKey(session.startTime);
      countsByDate.set(key, (countsByDate.get(key) || 0) + 1);
    }

    return {
      daily: Array.from(countsByDate.values()),
      labels,
    };
  }

  async getRealtime(): Promise<Record<string, unknown>> {
    const scope = await this.requireChargeScope();
    const stationIds = await this.tenantGuardrails.listOwnedStationIds(scope);
    const [activeSessions, chargePoints] = await Promise.all([
      this.prisma.session.count({
        where: {
          stationId: { in: stationIds },
          status: {
            in: ['ACTIVE', 'IN_PROGRESS'],
          },
        },
      }),
      this.prisma.chargePoint.findMany({
        where: {
          stationId: { in: stationIds },
        },
        select: {
          status: true,
          power: true,
        },
      }),
    ]);

    let currentLoad = 0;
    let onlineChargers = 0;
    for (const cp of chargePoints) {
      if (this.isChargePointOnline(cp.status)) {
        onlineChargers += 1;
        currentLoad += cp.power || 0;
      }
    }

    return {
      currentLoad: Number(currentLoad.toFixed(2)),
      activeSessions,
      onlineChargers,
    };
  }

  async getRegionalMetrics() {
    const scope = await this.requireChargeScope();
    const stations = await this.prisma.station.findMany({
      where: this.tenantGuardrails.buildOwnedStationWhere(scope),
      include: {
        zone: {
          include: { parent: { include: { parent: true } } },
        },
        owner: {
          include: { zone: true },
        },
        incidents: {
          where: { status: 'OPEN' },
        },
        chargePoints: {
          include: {
            sessions: true,
          },
        },
      },
    });

    const regionMap = new Map<
      string,
      {
        stations: number;
        sessions: number;
        revenue: number;
        incidents: number;
        onlineStationCount: number;
      }
    >();

    for (const station of stations) {
      let region = 'Unknown';

      if (station.zone) {
        const zoneLevels = [
          station.zone,
          station.zone.parent,
          station.zone.parent?.parent,
        ];
        let found = false;
        for (const current of zoneLevels) {
          if (!current) {
            continue;
          }
          if (
            current.type === 'CONTINENT' ||
            ['AFRICA', 'EUROPE', 'AMERICAS', 'ASIA', 'MIDDLE_EAST'].includes(
              current.code,
            )
          ) {
            region = current.name;
            found = true;
            break;
          }
        }
        if (!found) {
          for (let i = zoneLevels.length - 1; i >= 0; i -= 1) {
            const current = zoneLevels[i];
            if (current) {
              region = current.name;
              break;
            }
          }
        }
      } else if (station.owner?.zone) {
        region = station.owner.zone.name;
      } else if (station.owner?.region) {
        region = station.owner.region;
      }

      if (!regionMap.has(region)) {
        regionMap.set(region, {
          stations: 0,
          sessions: 0,
          revenue: 0,
          incidents: 0,
          onlineStationCount: 0,
        });
      }

      const metrics = regionMap.get(region)!;
      metrics.stations += 1;
      metrics.incidents += station.incidents.length;

      if (station.status === 'ACTIVE') {
        metrics.onlineStationCount += 1;
      }

      for (const cp of station.chargePoints) {
        metrics.sessions += cp.sessions.length;
        metrics.revenue += cp.sessions.reduce(
          (sum, session) => sum + (session.amount || 0),
          0,
        );
      }
    }

    return Array.from(regionMap.entries()).map(([region, metrics]) => {
      const uptime =
        metrics.stations > 0
          ? (metrics.onlineStationCount / metrics.stations) * 100
          : 0;

      return {
        region,
        stations: metrics.stations,
        sessions: metrics.sessions,
        revenue: metrics.revenue,
        status: uptime > 98 ? 'Healthy' : uptime > 90 ? 'Warning' : 'Critical',
        uptime: parseFloat(uptime.toFixed(1)),
        incidents: metrics.incidents,
      };
    });
  }

  async getSystemHealth() {
    return this.healthCheck.getSystemHealth();
  }

  private buildOwnerStationWhere(
    query: OwnerDashboardQueryDto,
    scopeOrgId: string | null,
    actorId: string | null,
  ): Prisma.StationWhereInput {
    const and: Prisma.StationWhereInput[] = [];

    if (scopeOrgId) {
      and.push({
        OR: [{ orgId: scopeOrgId }, { site: { organizationId: scopeOrgId } }],
      });
    } else if (actorId) {
      and.push({
        OR: [{ ownerId: actorId }, { site: { ownerId: actorId } }],
      });
    }

    if (query.siteId?.trim()) and.push({ siteId: query.siteId.trim() });
    if (query.stationId?.trim()) and.push({ id: query.stationId.trim() });
    if (query.state?.trim()) and.push({ status: query.state.trim() });
    if (query.chargerType?.trim()) {
      and.push({ chargePoints: { some: { type: query.chargerType.trim() } } });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private buildOwnerSessionWhere(
    query: OwnerDashboardQueryDto,
    stationIds: string[],
    start: Date,
    end: Date,
  ): Prisma.SessionWhereInput {
    const where: Prisma.SessionWhereInput = {
      stationId: { in: stationIds },
      startTime: { gte: start, lte: end },
    };
    if (query.sessionStatus?.trim()) where.status = query.sessionStatus.trim();
    if (query.chargerType?.trim()) {
      where.chargePoint = { type: query.chargerType.trim() };
    }
    return where;
  }

  private aggregateOwnerMetrics(
    stations: StationSnapshot[],
    sessions: SessionSnapshot[],
    incidents: Array<{
      id: string;
      stationId: string;
      chargePointId: string | null;
      title: string;
      severity: string;
      status: string;
      createdAt: Date;
    }>,
    uptimeByChargePoint: Map<
      string,
      { uptimePct: number | null; downtimeHours: number | null }
    >,
  ) {
    const chargePointCount = stations.reduce(
      (sum, station) => sum + station.chargePoints.length,
      0,
    );
    const statusCounts = {
      total: chargePointCount,
      online: 0,
      offline: 0,
      maintenance: 0,
    };

    let uptimeSum = 0;
    let uptimeSamples = 0;
    let downtimeHoursSum = 0;
    let downtimeHoursSamples = 0;

    const stationIndex = new Map(
      stations.map((station) => [station.id, station]),
    );

    for (const station of stations) {
      for (const chargePoint of station.chargePoints) {
        const bucket = this.resolveChargePointBucket(chargePoint.status);
        if (bucket === 'online') statusCounts.online += 1;
        else if (bucket === 'maintenance') statusCounts.maintenance += 1;
        else statusCounts.offline += 1;

        const uptime = uptimeByChargePoint.get(chargePoint.id);
        if (uptime?.uptimePct != null) {
          uptimeSum += uptime.uptimePct;
          uptimeSamples += 1;
        }
        if (uptime?.downtimeHours != null) {
          downtimeHoursSum += uptime.downtimeHours;
          downtimeHoursSamples += 1;
        }
      }
    }

    const revenue = sessions.reduce((sum, session) => sum + session.amount, 0);
    const energySoldKwh = sessions.reduce(
      (sum, session) => sum + session.totalEnergy,
      0,
    );
    const totalDurationMinutes = sessions.reduce((sum, session) => {
      if (!session.endTime) return sum;
      return sum + this.diffMinutes(session.startTime, session.endTime);
    }, 0);
    const completedDurationCount = sessions.filter((session) =>
      Boolean(session.endTime),
    ).length;
    const avgSessionDurationMinutes =
      completedDurationCount > 0
        ? Number((totalDurationMinutes / completedDurationCount).toFixed(1))
        : null;

    const { marginValue, revenueTrend, stationMargins } =
      this.computeMarginsByDay(sessions);
    const { heatmap, utilizationPct, stationUtilization } = this.buildHeatmap(
      sessions,
      chargePointCount,
    );

    const stationRollup = new Map<string, StationMetric>();
    for (const station of stations) {
      stationRollup.set(station.id, {
        stationId: station.id,
        stationName: station.name,
        siteId: station.siteId,
        siteName: station.siteName,
        revenue: 0,
        sessions: 0,
        utilizationPct: 0,
        uptimePct: this.averageChargePointUptime(
          station.chargePoints.map((chargePoint) =>
            uptimeByChargePoint.get(chargePoint.id),
          ),
        ),
        margin: stationMargins.get(station.id) ?? null,
        score: 0,
      });
    }

    for (const session of sessions) {
      const row = stationRollup.get(session.stationId);
      if (!row) continue;
      row.revenue += session.amount;
      row.sessions += 1;
      row.utilizationPct = stationUtilization.get(session.stationId) ?? 0;
    }

    for (const row of stationRollup.values()) {
      row.score =
        row.revenue * 0.45 +
        row.sessions * 10 +
        row.utilizationPct * 3 +
        (row.uptimePct ?? 0) * 2 +
        (row.margin ?? 0) * 0.2;
    }

    const sortedStations = Array.from(stationRollup.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.revenue - a.revenue;
    });

    const incidentRollup = new Map<
      string,
      { openCount: number; recurringCount: number; highestSeverity: string }
    >();
    for (const incident of incidents) {
      const bucket = incidentRollup.get(incident.stationId) || {
        openCount: 0,
        recurringCount: 0,
        highestSeverity: 'LOW',
      };
      if (incident.status === 'OPEN' || incident.status === 'IN_PROGRESS')
        bucket.openCount += 1;
      bucket.recurringCount += 1;
      bucket.highestSeverity = this.maxSeverity(
        bucket.highestSeverity,
        incident.severity,
      );
      incidentRollup.set(incident.stationId, bucket);
    }

    const incidentSummary = Array.from(incidentRollup.entries())
      .map(([stationId, item]) => ({
        stationId,
        stationName: stationIndex.get(stationId)?.name || stationId,
        openCount: item.openCount,
        recurringCount: item.recurringCount,
        highestSeverity: item.highestSeverity,
      }))
      .sort(
        (a, b) =>
          b.openCount - a.openCount || b.recurringCount - a.recurringCount,
      )
      .slice(0, 5);

    return {
      revenue: Number(revenue.toFixed(2)),
      energySoldKwh: Number(energySoldKwh.toFixed(2)),
      sessions: sessions.length,
      utilizationPct,
      uptimePct:
        uptimeSamples > 0
          ? Number((uptimeSum / uptimeSamples).toFixed(2))
          : null,
      activeStations: stations.filter((station) =>
        station.chargePoints.some((chargePoint) =>
          this.isChargePointOnline(chargePoint.status),
        ),
      ).length,
      avgSessionDurationMinutes,
      marginValue,
      revenueTrend,
      statusCounts,
      openIncidents: incidents.filter(
        (incident) =>
          incident.status === 'OPEN' || incident.status === 'IN_PROGRESS',
      ).length,
      recurringFaultStations: Array.from(incidentRollup.values()).filter(
        (item) => item.recurringCount >= 2,
      ).length,
      downtimeHours:
        downtimeHoursSamples > 0
          ? Number((downtimeHoursSum / downtimeHoursSamples).toFixed(2))
          : null,
      incidentSummary,
      heatmap,
      topStations: sortedStations.slice(0, 5),
      bottomStations: [...sortedStations]
        .sort((a, b) => a.score - b.score || a.revenue - b.revenue)
        .slice(0, 5),
    };
  }

  private buildHeatmap(sessions: SessionSnapshot[], chargePointCount: number) {
    const buckets = new Map<
      string,
      {
        day: string;
        hour: number;
        occupiedMinutes: number;
        sessionCount: number;
        energyKwh: number;
      }
    >();
    for (const day of HEATMAP_DAYS) {
      for (let hour = 0; hour < 24; hour += 1) {
        buckets.set(`${day}-${hour}`, {
          day,
          hour,
          occupiedMinutes: 0,
          sessionCount: 0,
          energyKwh: 0,
        });
      }
    }

    const stationOccupiedMinutes = new Map<string, number>();
    for (const session of sessions) {
      const start = session.startTime;
      const end = session.endTime || session.startTime;
      const sessionDuration = Math.max(0, this.diffMinutes(start, end));
      let cursor = new Date(start);

      while (cursor < end) {
        const bucketStart = new Date(cursor);
        bucketStart.setMinutes(0, 0, 0);
        const bucketEnd = new Date(bucketStart);
        bucketEnd.setHours(bucketEnd.getHours() + 1);
        const overlapStart = cursor > bucketStart ? cursor : bucketStart;
        const overlapEnd = end < bucketEnd ? end : bucketEnd;
        const overlapMinutes = Math.max(
          0,
          (overlapEnd.getTime() - overlapStart.getTime()) / 60000,
        );
        const key = `${DAY_LABELS[bucketStart.getDay()]}-${bucketStart.getHours()}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.occupiedMinutes += overlapMinutes;
          bucket.energyKwh +=
            sessionDuration > 0
              ? (session.totalEnergy * overlapMinutes) / sessionDuration
              : 0;
        }
        cursor = bucketEnd;
      }

      const sessionKey = `${DAY_LABELS[session.startTime.getDay()]}-${session.startTime.getHours()}`;
      const sessionBucket = buckets.get(sessionKey);
      if (sessionBucket) sessionBucket.sessionCount += 1;
      stationOccupiedMinutes.set(
        session.stationId,
        (stationOccupiedMinutes.get(session.stationId) || 0) + sessionDuration,
      );
    }

    const totalOccupiedMinutes = Array.from(buckets.values()).reduce(
      (sum, bucket) => sum + bucket.occupiedMinutes,
      0,
    );
    const totalCapacityMinutes =
      HEATMAP_DAYS.length * 24 * 60 * Math.max(chargePointCount, 1);
    return {
      heatmap: HEATMAP_DAYS.flatMap((day) =>
        Array.from({ length: 24 }, (_, hour) => {
          const bucket = buckets.get(`${day}-${hour}`)!;
          return {
            day,
            hour,
            utilizationPct:
              chargePointCount > 0
                ? Number(
                    (
                      (bucket.occupiedMinutes / (chargePointCount * 60)) *
                      100
                    ).toFixed(1),
                  )
                : 0,
            sessionCount: bucket.sessionCount,
            energyKwh: Number(bucket.energyKwh.toFixed(2)),
          };
        }),
      ),
      utilizationPct:
        chargePointCount > 0
          ? Number(
              ((totalOccupiedMinutes / totalCapacityMinutes) * 100).toFixed(1),
            )
          : 0,
      stationUtilization: new Map(
        Array.from(stationOccupiedMinutes.entries()).map(
          ([stationId, occupiedMinutes]) => [
            stationId,
            Number(((occupiedMinutes / (7 * 24 * 60)) * 100).toFixed(1)),
          ],
        ),
      ),
    };
  }

  private computeMarginsByDay(sessions: SessionSnapshot[]) {
    const trend = new Map<string, { revenue: number; cost: number }>();
    const stationMargins = new Map<string, number>();
    let revenueTotal = 0;
    let costTotal = 0;
    let hasCostData = false;

    for (const session of sessions) {
      const date = this.toDateKey(session.startTime);
      const bucket = trend.get(date) || { revenue: 0, cost: 0 };
      bucket.revenue += session.amount;
      revenueTotal += session.amount;

      if (session.receiptTransactions.length > 0) {
        const sessionCost = session.receiptTransactions.reduce(
          (sum, receipt) =>
            sum + (receipt.energyCost || 0) + (receipt.taxes || 0),
          0,
        );
        bucket.cost += sessionCost;
        costTotal += sessionCost;
        stationMargins.set(
          session.stationId,
          (stationMargins.get(session.stationId) || 0) +
            (session.amount - sessionCost),
        );
        hasCostData = true;
      }
      trend.set(date, bucket);
    }

    return {
      marginValue: hasCostData
        ? Number((revenueTotal - costTotal).toFixed(2))
        : null,
      revenueTrend: Array.from(trend.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({
          date,
          revenue: Number(value.revenue.toFixed(2)),
          cost: Number(value.cost.toFixed(2)),
          margin: hasCostData
            ? Number((value.revenue - value.cost).toFixed(2))
            : null,
        })),
      stationMargins,
    };
  }

  private buildOwnerAlerts(input: {
    stations: StationSnapshot[];
    current: ReturnType<AnalyticsService['aggregateOwnerMetrics']>;
    previous: ReturnType<AnalyticsService['aggregateOwnerMetrics']>;
    currentSessions: SessionSnapshot[];
    incidents: Array<{
      id: string;
      stationId: string;
      chargePointId: string | null;
      title: string;
      severity: string;
      status: string;
      createdAt: Date;
    }>;
    end: Date;
  }): OwnerDashboardResponseDto['alerts'] {
    const alerts: OwnerDashboardResponseDto['alerts'] = [];

    for (const station of input.stations) {
      for (const chargePoint of station.chargePoints) {
        const latestHistory =
          chargePoint.statusHistory[chargePoint.statusHistory.length - 1];
        const offlineHours = latestHistory
          ? (input.end.getTime() - latestHistory.timestamp.getTime()) /
            3_600_000
          : 0;
        if (
          !this.isChargePointOnline(chargePoint.status) &&
          offlineHours >= ALERT_OFFLINE_THRESHOLD_HOURS
        ) {
          alerts.push({
            severity: 'high',
            message: `${station.name} has a charger offline for more than ${ALERT_OFFLINE_THRESHOLD_HOURS} hours`,
            reasonCode: 'CHARGER_OFFLINE_PROLONGED',
            targetType: 'chargePoint',
            targetId: chargePoint.id,
            recommendedPath: `/stations/charge-points/${chargePoint.id}`,
          });
        }
      }
    }

    const marginDelta = this.percentDeltaNullable(
      input.current.marginValue,
      input.previous.marginValue,
    );
    if (marginDelta != null && marginDelta <= -10) {
      alerts.push({
        severity: 'high',
        message: `Margin dropped ${Math.abs(marginDelta).toFixed(1)}% versus the previous period`,
        reasonCode: 'MARGIN_DROP',
        targetType: 'portfolio',
        targetId: null,
        recommendedPath: '/billing?period=30d',
      });
    }

    const peakHeatmap = [...input.current.heatmap].sort(
      (a, b) => b.utilizationPct - a.utilizationPct,
    )[0];
    if (peakHeatmap && peakHeatmap.utilizationPct >= 85) {
      alerts.push({
        severity: 'medium',
        message: `Peak utilization exceeded 85% on ${peakHeatmap.day} at ${String(peakHeatmap.hour).padStart(2, '0')}:00`,
        reasonCode: 'PEAK_UTILIZATION',
        targetType: 'portfolio',
        targetId: null,
        recommendedPath: '/sessions?preset=all',
      });
    }

    const failedSessionsByStation = new Map<string, number>();
    for (const session of input.currentSessions) {
      if (session.status === 'COMPLETED' || session.status === 'ACTIVE')
        continue;
      failedSessionsByStation.set(
        session.stationId,
        (failedSessionsByStation.get(session.stationId) || 0) + 1,
      );
    }
    for (const [stationId, count] of failedSessionsByStation.entries()) {
      if (count < 3) continue;
      alerts.push({
        severity: 'high',
        message: `${input.stations.find((station) => station.id === stationId)?.name || 'Station'} has repeated session failures`,
        reasonCode: 'SESSION_FAILURE_REPEAT',
        targetType: 'station',
        targetId: stationId,
        recommendedPath: `/stations/${stationId}`,
      });
    }

    for (const station of input.current.bottomStations) {
      if (station.utilizationPct > 15) continue;
      alerts.push({
        severity: 'medium',
        message: `${station.stationName} is underused and may need tariff or demand action`,
        reasonCode: 'STATION_UNDERUSED',
        targetType: 'station',
        targetId: station.stationId,
        recommendedPath: `/stations/${station.stationId}`,
      });
    }

    for (const item of input.current.incidentSummary) {
      if (item.recurringCount < 2) continue;
      alerts.push({
        severity: item.highestSeverity === 'CRITICAL' ? 'critical' : 'high',
        message: `${item.stationName} has recurring incidents requiring maintenance attention`,
        reasonCode: 'INCIDENT_HOTSPOT',
        targetType: 'station',
        targetId: item.stationId,
        recommendedPath: `/incidents?stationId=${item.stationId}`,
      });
    }

    return alerts
      .sort(
        (a, b) =>
          this.alertSeverityRank(a.severity) -
          this.alertSeverityRank(b.severity),
      )
      .slice(0, 8);
  }

  private calculateChargePointUptime(
    currentStatus: string,
    history: Array<{ status: string; timestamp: Date }>,
    start: Date,
    end: Date,
  ) {
    const relevant = history.filter((entry) => entry.timestamp <= end);
    if (relevant.length === 0) {
      return {
        uptimePct: null,
        downtimeHours: null,
      };
    }

    const points = relevant.filter((entry) => entry.timestamp >= start);
    const baseline = [...relevant]
      .reverse()
      .find((entry) => entry.timestamp <= start);
    const timeline = [
      { status: baseline?.status || currentStatus, timestamp: start },
      ...points,
      { status: currentStatus, timestamp: end },
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    let onlineMs = 0;
    let maintenanceMs = 0;
    let offlineMs = 0;
    for (let index = 0; index < timeline.length - 1; index += 1) {
      const current = timeline[index];
      const next = timeline[index + 1];
      const duration = Math.max(
        0,
        next.timestamp.getTime() - current.timestamp.getTime(),
      );
      const bucket = this.resolveChargePointBucket(current.status);
      if (bucket === 'online') onlineMs += duration;
      else if (bucket === 'maintenance') maintenanceMs += duration;
      else offlineMs += duration;
    }

    const totalMs = Math.max(1, end.getTime() - start.getTime());
    return {
      uptimePct: Number(
        (((onlineMs + maintenanceMs * 0.5) / totalMs) * 100).toFixed(2),
      ),
      downtimeHours: Number((offlineMs / 3_600_000).toFixed(2)),
    };
  }

  private emptyOwnerDashboard(
    window: RangeWindow,
    query: OwnerDashboardQueryDto,
  ): OwnerDashboardResponseDto {
    return {
      filters: {
        range: window.range,
        compare: window.compare,
        siteId: query.siteId || null,
        stationId: query.stationId || null,
        chargerType: query.chargerType || null,
        sessionStatus: query.sessionStatus || null,
        state: query.state || null,
      },
      kpis: {
        revenue: { value: 0, deltaPct: null },
        energySoldKwh: { value: 0, deltaPct: null },
        sessions: { value: 0, deltaPct: null },
        utilizationPct: { value: 0, deltaPct: null },
        uptimePct: { value: null, deltaPct: null },
        activeStations: { value: 0, deltaPct: null },
        avgSessionDurationMinutes: { value: null, deltaPct: null },
        margin: { value: null, deltaPct: null, available: false },
      },
      commercial: { revenueCostMarginTrend: [] },
      operations: {
        statusCounts: { total: 0, online: 0, offline: 0, maintenance: 0 },
        openIncidents: 0,
        recurringFaultStations: 0,
        downtimeHours: null,
        incidentSummary: [],
      },
      utilization: {
        heatmap: HEATMAP_DAYS.flatMap((day) =>
          Array.from({ length: 24 }, (_, hour) => ({
            day,
            hour,
            utilizationPct: 0,
            sessionCount: 0,
            energyKwh: 0,
          })),
        ),
        topSites: [],
        underperformingSites: [],
      },
      alerts: [],
    };
  }

  private resolveWindow(query: OwnerDashboardQueryDto): RangeWindow {
    const range = query.range || '30d';
    const compare = query.compare || 'previous';
    const now = new Date();
    let start: Date;
    if (range === 'ALL')
      start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    else if (range === 'YTD') start = new Date(now.getFullYear(), 0, 1);
    else
      start = new Date(
        now.getTime() -
          ((range === '7d' ? 7 : range === '90d' ? 90 : 30) - 1) *
            24 *
            60 *
            60 *
            1000,
      );

    const normalizedStart = this.startOfDay(start);
    const normalizedEnd = this.endOfDay(now);
    if (compare === 'none') {
      return {
        range,
        compare,
        start: normalizedStart,
        end: normalizedEnd,
        previousStart: null,
        previousEnd: null,
      };
    }

    const spanDays = Math.max(
      1,
      Math.round(
        (this.startOfDay(normalizedEnd).getTime() -
          this.startOfDay(normalizedStart).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1,
    );
    const previousEnd = new Date(normalizedStart.getTime() - 1);
    const previousStart = this.startOfDay(
      new Date(previousEnd.getTime() - (spanDays - 1) * 24 * 60 * 60 * 1000),
    );
    return {
      range,
      compare,
      start: normalizedStart,
      end: normalizedEnd,
      previousStart,
      previousEnd: this.endOfDay(previousEnd),
    };
  }

  private averageChargePointUptime(
    items: Array<
      { uptimePct: number | null; downtimeHours: number | null } | undefined
    >,
  ) {
    const available = items.filter(
      (
        item,
      ): item is { uptimePct: number | null; downtimeHours: number | null } =>
        Boolean(item && item.uptimePct != null),
    );
    if (available.length === 0) return null;
    return Number(
      (
        available.reduce((sum, item) => sum + (item.uptimePct || 0), 0) /
        available.length
      ).toFixed(2),
    );
  }

  private resolveChargePointBucket(
    status?: string | null,
  ): 'online' | 'maintenance' | 'offline' {
    const normalized = (status || '').trim().toUpperCase();
    if (['ONLINE', 'AVAILABLE', 'CHARGING', 'OCCUPIED'].includes(normalized))
      return 'online';
    if (['MAINTENANCE', 'DEGRADED', 'RESERVED'].includes(normalized))
      return 'maintenance';
    return 'offline';
  }

  private resolveStationStatusBucket(
    status?: string | null,
  ): 'online' | 'maintenance' | 'offline' {
    const normalized = (status || '').trim().toUpperCase();
    if (['ACTIVE', 'ONLINE', 'AVAILABLE'].includes(normalized)) return 'online';
    if (['MAINTENANCE', 'DEGRADED'].includes(normalized)) return 'maintenance';
    return 'offline';
  }

  private stationStatusToUptime(
    status: 'online' | 'maintenance' | 'offline',
  ): number {
    if (status === 'online') return 100;
    if (status === 'maintenance') return 85;
    return 0;
  }

  private isChargePointOnline(status?: string | null): boolean {
    return this.resolveChargePointBucket(status) === 'online';
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private startOfDay(value: Date) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      0,
      0,
      0,
      0,
    );
  }

  private endOfDay(value: Date) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      23,
      59,
      59,
      999,
    );
  }

  private diffMinutes(start: Date, end: Date) {
    return Math.max(0, (end.getTime() - start.getTime()) / 60000);
  }

  private diffHours(start: Date, end: Date) {
    return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
  }

  private percentDelta(current: number, previous: number) {
    if (previous === 0) return current === 0 ? 0 : null;
    return Number((((current - previous) / previous) * 100).toFixed(1));
  }

  private percentDeltaNullable(
    current: number | null,
    previous: number | null,
  ) {
    if (current == null || previous == null) return null;
    return this.percentDelta(current, previous);
  }

  private maxSeverity(a: string, b: string) {
    const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    return order.indexOf(a) >= order.indexOf(b) ? a : b;
  }

  private alertSeverityRank(severity: 'critical' | 'high' | 'medium' | 'low') {
    if (severity === 'critical') return 0;
    if (severity === 'high') return 1;
    if (severity === 'medium') return 2;
    return 3;
  }
}
