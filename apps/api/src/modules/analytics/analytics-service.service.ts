import { Injectable } from '@nestjs/common';

@Injectable()
export class AnalyticsService {
  getHello(): string {
    return 'Analytics Service Operational';
  }

  getDashboard(period: string) {
    return {
      totalEnergy: 54000,
      totalSessions: 1200,
      revenue: 5600,
      activeChargers: 45,
      utilization: 68, // percent
      period
    };
  }

  getUptime(stationId?: string) {
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
}
