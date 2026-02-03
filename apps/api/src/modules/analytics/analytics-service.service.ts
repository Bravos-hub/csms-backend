import { Injectable } from '@nestjs/common';
import { HealthCheckService } from './health-check.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly healthCheck: HealthCheckService) { }

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

  getRegionalMetrics() {
    return [
      { region: 'North America', stations: 120, sessions: 4500, revenue: 125000, status: 'Healthy', uptime: 99.9, incidents: 0 },
      { region: 'Europe', stations: 85, sessions: 3200, revenue: 98000, status: 'Healthy', uptime: 99.5, incidents: 1 },
      { region: 'Asia Pacific', stations: 45, sessions: 1800, revenue: 45000, status: 'Warning', uptime: 98.2, incidents: 3 },
      { region: 'Middle East', stations: 30, sessions: 1200, revenue: 28000, status: 'Healthy', uptime: 99.8, incidents: 0 },
    ];
  }

  // Use real health checks instead of mocked data
  async getSystemHealth() {
    return this.healthCheck.getSystemHealth();
  }
}

