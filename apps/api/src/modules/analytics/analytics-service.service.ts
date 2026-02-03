import { Injectable } from '@nestjs/common';
import { HealthCheckService } from './health-check.service';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly healthCheck: HealthCheckService,
    private readonly prisma: PrismaService
  ) { }

  getHello(): string {
    return 'Analytics Service Operational';
  }

  getDashboard(period: string): Record<string, unknown> {
    return {
      totalEnergy: 54000,
      totalSessions: 1200,
      revenue: 5600,
      activeChargers: 45,
      utilization: 68, // percent
      period
    };
  }

  getUptime(stationId?: string): Record<string, unknown> {
    return {
      uptime: 99.8,
      downtime: 0.2,
      lastOutage: null
    };
  }

  getUsage() {
    return {
      daily: [100, 120, 140, 130, 150, 160, 145],
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    };
  }

  getRealtime() {
    return {
      currentLoad: 450, // kW
      activeSessions: 12
    };
  }

  async getRegionalMetrics() {
    // Fetch all stations with relevant data
    // Fetch all stations with relevant data
    const stations = await this.prisma.station.findMany({
      include: {
        zone: {
          include: { parent: { include: { parent: true } } }
        },
        owner: {
          include: { zone: true }
        },
        incidents: {
          where: { status: 'OPEN' }
        },
        chargePoints: {
          include: {
            sessions: true
          }
        }
      }
    });

    // Group by region
    const regionMap = new Map<string, {
      stations: number,
      sessions: number,
      revenue: number,
      uptime: number,
      incidents: number,
      onlineStationCount: number
    }>();

    for (const station of stations) {
      // Prioritize: Station Zone Hierarchy -> Owner Zone -> Owner Region String -> Unknown
      let region = 'Unknown';
      const s = station as any;

      if (s.zone) {
        // Traverse up to find Continent or root
        let current = s.zone;
        let found = false;
        for (let i = 0; i < 5; i++) {
          if (current.type === 'CONTINENT' || ['AFRICA', 'EUROPE', 'AMERICAS', 'ASIA', 'MIDDLE_EAST'].includes(current.code)) {
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
          onlineStationCount: 0
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
        metrics.revenue += cp.sessions.reduce((sum: number, session: any) => sum + (session.amount || 0), 0);
      }
    }

    // Format output
    return Array.from(regionMap.entries()).map(([region, metrics]) => {
      // Simple uptime calculation: (online / total) * 100
      const uptime = metrics.stations > 0
        ? (metrics.onlineStationCount / metrics.stations) * 100
        : 0;

      return {
        region,
        stations: metrics.stations,
        sessions: metrics.sessions,
        revenue: metrics.revenue,
        // Determine status based on uptime
        status: uptime > 98 ? 'Healthy' : (uptime > 90 ? 'Warning' : 'Critical'),
        uptime: parseFloat(uptime.toFixed(1)),
        incidents: metrics.incidents
      };
    });
  }

  // Use real health checks instead of mocked data
  async getSystemHealth() {
    return this.healthCheck.getSystemHealth();
  }
}

