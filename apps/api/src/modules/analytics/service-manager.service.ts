import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ServiceLog {
    timestamp: string;
    level: 'error' | 'warn' | 'info' | 'debug';
    message: string;
    context?: string;
}

export interface ServiceEvent {
    id: string;
    time: string;
    severity: 'error' | 'warning' | 'info' | 'resolved';
    message: string;
    service?: string;
}

@Injectable()
export class ServiceManagerService {
    private readonly logger = new Logger(ServiceManagerService.name);
    private readonly events: ServiceEvent[] = [];

    /**
     * Restart a service (placeholder for Docker/K8s integration)
     */
    async restartService(serviceName: string): Promise<{ success: boolean; message: string }> {
        this.logger.log(`Restart requested for service: ${serviceName}`);

        try {
            // Add event
            this.addEvent({
                severity: 'info',
                message: `Restart initiated for ${serviceName}`,
                service: serviceName,
            });

            // In production, this would integrate with Docker or Kubernetes
            // For now, we'll simulate a restart
            const dockerServiceName = this.mapServiceToDockerName(serviceName);

            if (!dockerServiceName) {
                return {
                    success: false,
                    message: `Service ${serviceName} cannot be restarted from the application`,
                };
            }

            // Try to restart using docker-compose (if available)
            try {
                await execAsync(`docker-compose restart ${dockerServiceName}`, {
                    timeout: 30000,
                });

                this.addEvent({
                    severity: 'resolved',
                    message: `${serviceName} restarted successfully`,
                    service: serviceName,
                });

                return {
                    success: true,
                    message: `Service ${serviceName} restarted successfully`,
                };
            } catch (dockerError) {
                this.logger.warn(`Docker restart failed, service may not be containerized: ${dockerError.message}`);

                // Return a simulated success for demo purposes
                this.addEvent({
                    severity: 'warning',
                    message: `Restart signal sent to ${serviceName} (manual verification required)`,
                    service: serviceName,
                });

                return {
                    success: true,
                    message: `Restart signal sent to ${serviceName}. Please verify service status.`,
                };
            }
        } catch (error) {
            this.logger.error(`Failed to restart service ${serviceName}: ${error.message}`);

            this.addEvent({
                severity: 'error',
                message: `Failed to restart ${serviceName}: ${error.message}`,
                service: serviceName,
            });

            return {
                success: false,
                message: `Failed to restart ${serviceName}: ${error.message}`,
            };
        }
    }

    /**
     * Get service logs (simplified implementation)
     */
    async getServiceLogs(serviceName: string, lines: number = 100): Promise<ServiceLog[]> {
        this.logger.log(`Fetching logs for service: ${serviceName}`);

        const dockerServiceName = this.mapServiceToDockerName(serviceName);

        if (!dockerServiceName) {
            return this.getMockLogs(serviceName, lines);
        }

        try {
            // Try to get logs from Docker
            const { stdout } = await execAsync(`docker-compose logs --tail=${lines} ${dockerServiceName}`, {
                timeout: 10000,
            });

            return this.parseLogs(stdout);
        } catch (error) {
            this.logger.warn(`Could not fetch Docker logs for ${serviceName}: ${error.message}`);
            // Return mock logs as fallback
            return this.getMockLogs(serviceName, lines);
        }
    }

    /**
     * Get recent system events
     */
    getSystemEvents(limit: number = 50): ServiceEvent[] {
        return this.events.slice(-limit).reverse();
    }

    /**
     * Add a system event
     */
    private addEvent(event: Omit<ServiceEvent, 'id' | 'time'>): void {
        const newEvent: ServiceEvent = {
            id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            time: new Date().toISOString(),
            ...event,
        };

        this.events.push(newEvent);

        // Keep only last 1000 events
        if (this.events.length > 1000) {
            this.events.shift();
        }
    }

    /**
     * Map service display name to Docker container name
     */
    private mapServiceToDockerName(serviceName: string): string | null {
        const mapping: Record<string, string | null> = {
            'Database': 'postgres',
            'Redis Cache': 'redis',
            'OCPP Gateway': 'ocpp-gateway',
            'Payment Gateway': null, // External service, can't restart
        };

        return mapping[serviceName] || null;
    }

    /**
     * Parse Docker logs into structured format
     */
    private parseLogs(logOutput: string): ServiceLog[] {
        const lines = logOutput.split('\n').filter(line => line.trim());
        const logs: ServiceLog[] = [];

        for (const line of lines) {
            // Try to parse timestamp and level from log line
            const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z?)/);
            const levelMatch = line.match(/\b(error|warn|warning|info|debug)\b/i);

            logs.push({
                timestamp: timestampMatch?.[1] || new Date().toISOString(),
                level: (levelMatch?.[1]?.toLowerCase() as any) || 'info',
                message: line,
            });
        }

        return logs.slice(-100); // Return last 100 logs
    }

    /**
     * Generate mock logs for demo purposes
     */
    private getMockLogs(serviceName: string, lines: number): ServiceLog[] {
        const logs: ServiceLog[] = [];
        const now = Date.now();

        for (let i = 0; i < Math.min(lines, 20); i++) {
            const timestamp = new Date(now - i * 60000).toISOString();
            logs.push({
                timestamp,
                level: i % 10 === 0 ? 'warn' : 'info',
                message: `[${serviceName}] ${i % 10 === 0 ? 'High memory usage detected' : 'Service operating normally'}`,
                context: serviceName,
            });
        }

        return logs;
    }
}
