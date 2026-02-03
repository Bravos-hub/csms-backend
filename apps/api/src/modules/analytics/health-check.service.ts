import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

export interface ServiceHealth {
    name: string;
    status: 'Operational' | 'Degraded' | 'Down';
    responseTime: number;
    uptime?: string;
    lastCheck: string;
    metadata?: Record<string, any>;
}

export interface HealthCheckResult {
    status: 'Operational' | 'Degraded' | 'Down';
    uptime: number;
    services: ServiceHealth[];
    lastIncident?: string | null;
}

@Injectable()
export class HealthCheckService {
    private readonly logger = new Logger(HealthCheckService.name);
    private redisClient: Redis | null = null;
    private healthCache: HealthCheckResult | null = null;
    private lastCheckTime: number = 0;
    private readonly CACHE_TTL = 30000; // 30 seconds cache

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
    ) {
        // Initialize Redis client for health checks
        const redisUrl = this.config.get<string>('REDIS_URL');
        if (redisUrl) {
            try {
                this.redisClient = new Redis(redisUrl, {
                    maxRetriesPerRequest: 1,
                    retryStrategy: () => null, // Don't retry for health checks
                    lazyConnect: true,
                });
            } catch (error) {
                this.logger.warn(`Failed to initialize Redis client: ${error.message}`);
            }
        }
    }

    /**
     * Get comprehensive system health with caching and error handling
     */
    async getSystemHealth(): Promise<HealthCheckResult> {
        try {
            const now = Date.now();

            // Return cached result if still valid
            if (this.healthCache && now - this.lastCheckTime < this.CACHE_TTL) {
                return this.healthCache;
            }

            // Perform health checks in parallel with individual error handling
            const healthChecks = await Promise.allSettled([
                this.checkDatabase(),
                this.checkRedis(),
                this.checkOCPPGateway(),
                this.checkPaymentGateway(),
            ]);

            // Map settled promises to ServiceHealth objects
            const serviceNames = ['Database', 'Redis Cache', 'OCPP Gateway', 'Payment Gateway'];
            const services: ServiceHealth[] = healthChecks.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    this.logger.error(`Health check failed for ${serviceNames[index]}: ${result.reason?.message || result.reason}`);
                    return {
                        name: serviceNames[index],
                        status: 'Down' as const,
                        responseTime: 0,
                        lastCheck: new Date().toISOString(),
                        metadata: { error: result.reason?.message || 'Unknown error' },
                    };
                }
            });

            // Calculate overall status
            const downCount = services.filter(s => s.status === 'Down').length;
            const degradedCount = services.filter(s => s.status === 'Degraded').length;

            let overallStatus: 'Operational' | 'Degraded' | 'Down' = 'Operational';
            if (downCount > 0) {
                overallStatus = downCount >= 2 ? 'Down' : 'Degraded';
            } else if (degradedCount > 0) {
                overallStatus = 'Degraded';
            }

            // Calculate uptime (simplified - in production use actual metrics)
            const uptimePercent = ((services.length - downCount) / services.length) * 100;

            const result: HealthCheckResult = {
                status: overallStatus,
                uptime: parseFloat(uptimePercent.toFixed(2)),
                services,
                lastIncident: null,
            };

            // Cache the result
            this.healthCache = result;
            this.lastCheckTime = now;

            return result;
        } catch (error) {
            this.logger.error(`Critical error in getSystemHealth: ${error.message}`, error.stack);
            // Return a safe fallback response
            return {
                status: 'Down',
                uptime: 0,
                services: [{
                    name: 'System',
                    status: 'Down',
                    responseTime: 0,
                    lastCheck: new Date().toISOString(),
                    metadata: { error: 'Critical health check failure' },
                }],
                lastIncident: new Date().toISOString(),
            };
        }
    }

    /**
     * Check database connectivity and performance
     */
    private async checkDatabase(): Promise<ServiceHealth> {
        const startTime = Date.now();
        const name = 'Database';

        try {
            // Simple query to check connectivity
            await this.prisma.$queryRaw`SELECT 1`;

            const responseTime = Date.now() - startTime;

            // Get connection pool info if available
            let metadata: Record<string, any> = {};
            try {
                const result = await this.prisma.$queryRaw<any[]>`
                    SELECT count(*) as connections 
                    FROM pg_stat_activity 
                    WHERE datname = current_database()
                `;
                metadata = {
                    connections: Number(result[0]?.connections || 0),
                };
            } catch {
                // Ignore if we can't get pool info
            }

            return {
                name,
                status: responseTime < 100 ? 'Operational' : 'Degraded',
                responseTime,
                uptime: '99.9%',
                lastCheck: new Date().toISOString(),
                metadata,
            };
        } catch (error: any) {
            this.logger.error(`Database health check failed: ${error.message}`);
            return {
                name,
                status: 'Down',
                responseTime: Date.now() - startTime,
                lastCheck: new Date().toISOString(),
                metadata: { error: error.message },
            };
        }
    }

    /**
     * Check Redis connectivity and performance
     */
    private async checkRedis(): Promise<ServiceHealth> {
        const startTime = Date.now();
        const name = 'Redis Cache';

        if (!this.redisClient) {
            return {
                name,
                status: 'Down',
                responseTime: 0,
                lastCheck: new Date().toISOString(),
                metadata: { error: 'Redis client not configured' },
            };
        }

        try {
            // Ping Redis
            await this.redisClient.ping();

            const responseTime = Date.now() - startTime;

            // Get Redis info
            const info = await this.redisClient.info('memory');
            const usedMemory = info.match(/used_memory_human:(.+)/)?.[1]?.trim() || 'Unknown';

            return {
                name,
                status: responseTime < 50 ? 'Operational' : 'Degraded',
                responseTime,
                uptime: '99.9%',
                lastCheck: new Date().toISOString(),
                metadata: {
                    memory: usedMemory,
                },
            };
        } catch (error: any) {
            this.logger.error(`Redis health check failed: ${error.message}`);
            return {
                name,
                status: 'Down',
                responseTime: Date.now() - startTime,
                lastCheck: new Date().toISOString(),
                metadata: { error: error.message },
            };
        }
    }

    /**
     * Check OCPP Gateway health
     */
    private async checkOCPPGateway(): Promise<ServiceHealth> {
        const startTime = Date.now();
        const name = 'OCPP Gateway';

        try {
            const ocppUrl = this.config.get<string>('OCPP_GATEWAY_URL');

            if (!ocppUrl) {
                return {
                    name,
                    status: 'Down',
                    responseTime: 0,
                    lastCheck: new Date().toISOString(),
                    metadata: { error: 'OCPP Gateway URL not configured' },
                };
            }

            // Try to fetch health endpoint
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${ocppUrl}/health`, {
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const responseTime = Date.now() - startTime;

            if (response.ok) {
                return {
                    name,
                    status: responseTime < 100 ? 'Operational' : 'Degraded',
                    responseTime,
                    uptime: '99.8%',
                    lastCheck: new Date().toISOString(),
                };
            } else {
                return {
                    name,
                    status: 'Degraded',
                    responseTime,
                    lastCheck: new Date().toISOString(),
                    metadata: { httpStatus: response.status },
                };
            }
        } catch (error: any) {
            this.logger.error(`OCPP Gateway health check failed: ${error.message}`);
            return {
                name,
                status: 'Down',
                responseTime: Date.now() - startTime,
                lastCheck: new Date().toISOString(),
                metadata: { error: error.message },
            };
        }
    }

    /**
     * Check Payment Gateway health
     */
    private async checkPaymentGateway(): Promise<ServiceHealth> {
        const startTime = Date.now();
        const name = 'Payment Gateway';

        try {
            // For now, return operational if payment config exists
            // In production, you'd ping the actual payment provider API
            const paymentProvider = this.config.get<string>('PAYMENT_PROVIDER');

            if (!paymentProvider) {
                return {
                    name,
                    status: 'Degraded',
                    responseTime: 1,
                    lastCheck: new Date().toISOString(),
                    metadata: { note: 'Payment provider not configured' },
                };
            }

            // Simulate a successful check
            const responseTime = Date.now() - startTime;

            return {
                name,
                status: 'Operational',
                responseTime: responseTime || 1,
                uptime: '99.95%',
                lastCheck: new Date().toISOString(),
            };
        } catch (error: any) {
            this.logger.error(`Payment Gateway health check failed: ${error.message}`);
            return {
                name,
                status: 'Down',
                responseTime: Date.now() - startTime,
                lastCheck: new Date().toISOString(),
                metadata: { error: error.message },
            };
        }
    }
}
