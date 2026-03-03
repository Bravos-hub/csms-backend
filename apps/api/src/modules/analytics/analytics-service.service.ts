import { Injectable } from '@nestjs/common';
import { HealthCheckService } from './health-check.service';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly healthCheck: HealthCheckService,
    private readonly prisma: PrismaService,
  ) {}

  getHello(): string {
    return 'Analytics Service Operational';
  }

  async getDashboard(period: string): Promise<Record<string, unknown>> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOf24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startOf7d = new Date(startOfDay);
    startOf7d.setDate(startOf7d.getDate() - 6);

    const [
      stations,
      chargePoints,
      todaySessionsAggregate,
      activeSessionsCount,
      incidents24hCount,
      sessionsLast7Days,
    ] = await Promise.all([
      this.prisma.station.findMany({
        select: {
          id: true,
          name: true,
          status: true,
        },
      }),
      this.prisma.chargePoint.findMany({
        select: {
          id: true,
          stationId: true,
          status: true,
          power: true,
        },
      }),
      this.prisma.session.aggregate({
        where: {
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
          status: {
            in: ['ACTIVE', 'IN_PROGRESS'],
          },
        },
      }),
      this.prisma.incident.count({
        where: {
          createdAt: {
            gte: startOf24h,
          },
        },
      }),
      this.prisma.session.findMany({
        where: {
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

    const stationStatusById = new Map<string, 'online' | 'maintenance' | 'offline'>();
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
      {
        sessions: number;
        revenue: number;
      }
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
      revenueByDate.set(key, (revenueByDate.get(key) || 0) + (session.amount || 0));

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
    const todayRevenue = Number((todaySessionsAggregate._sum.amount || 0).toFixed(2));
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

      // Legacy fields retained for compatibility with any existing consumers.
      totalEnergy: todayEnergy,
      totalSessions: todaySessions,
      revenue: todayRevenue,
      activeChargers: onlineChargers,
      utilization: utilizationPercent,

      // Canonical dashboard payload used by evzone-portals widgets.
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

  async getUptime(stationId?: string): Promise<Record<string, unknown>> {
    if (stationId) {
      const station = await this.prisma.station.findUnique({
        where: { id: stationId },
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
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOf7d = new Date(startOfDay);
    startOf7d.setDate(startOf7d.getDate() - 6);

    const sessions = await this.prisma.session.findMany({
      where: {
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
    const [activeSessions, chargePoints] = await Promise.all([
      this.prisma.session.count({
        where: {
          status: {
            in: ['ACTIVE', 'IN_PROGRESS'],
          },
        },
      }),
      this.prisma.chargePoint.findMany({
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
    // Fetch all stations with relevant data.
    const stations = await this.prisma.station.findMany({
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

    // Group by region
    const regionMap = new Map<
      string,
      {
        stations: number;
        sessions: number;
        revenue: number;
        uptime: number;
        incidents: number;
        onlineStationCount: number;
      }
    >();

    for (const station of stations) {
      // Prioritize: Station Zone Hierarchy -> Owner Zone -> Owner Region String -> Unknown
      let region = 'Unknown';
      const s = station as any;

      if (s.zone) {
        // Traverse up to find Continent or root
        let current = s.zone;
        let found = false;
        for (let i = 0; i < 5; i++) {
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
          if (!current.parent) break;
          current = current.parent;
        }
        if (!found) {
          region = current.name; // Use top-most found if no continent
        }
      } else if (s.owner?.zone) {
        region = s.owner.zone.name;
      } else if (s.owner?.region) {
        region = s.owner.region;
      }

      if (!regionMap.has(region)) {
        regionMap.set(region, {
          stations: 0,
          sessions: 0,
          revenue: 0,
          uptime: 0,
          incidents: 0,
          onlineStationCount: 0,
        });
      }

      const metrics = regionMap.get(region)!;
      metrics.stations++;
      metrics.incidents += s.incidents.length;

      if (station.status === 'ACTIVE') {
        metrics.onlineStationCount++;
      }

      // Aggregate sessions and revenue
      for (const cp of s.chargePoints) {
        metrics.sessions += cp.sessions.length;
        metrics.revenue += cp.sessions.reduce(
          (sum: number, session: any) => sum + (session.amount || 0),
          0,
        );
      }
    }

    // Format output
    return Array.from(regionMap.entries()).map(([region, metrics]) => {
      // Simple uptime calculation: (online / total) * 100
      const uptime =
        metrics.stations > 0
          ? (metrics.onlineStationCount / metrics.stations) * 100
          : 0;

      return {
        region,
        stations: metrics.stations,
        sessions: metrics.sessions,
        revenue: metrics.revenue,
        // Determine status based on uptime
        status: uptime > 98 ? 'Healthy' : uptime > 90 ? 'Warning' : 'Critical',
        uptime: parseFloat(uptime.toFixed(1)),
        incidents: metrics.incidents,
      };
    });
  }

  // Use real health checks instead of mocked data
  async getSystemHealth() {
    return this.healthCheck.getSystemHealth();
  }

  private resolveStationStatusBucket(
    status?: string | null,
  ): 'online' | 'maintenance' | 'offline' {
    const normalized = (status || '').trim().toUpperCase();
    if (['ACTIVE', 'ONLINE', 'AVAILABLE'].includes(normalized)) {
      return 'online';
    }
    if (['MAINTENANCE', 'DEGRADED'].includes(normalized)) {
      return 'maintenance';
    }
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
    const normalized = (status || '').trim().toUpperCase();
    return ['ONLINE', 'AVAILABLE', 'CHARGING', 'OCCUPIED'].includes(
      normalized,
    );
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
