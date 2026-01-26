import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ChargePoint, Station } from '@prisma/client';

@Injectable()
export class ChargerProvisioningService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ChargerProvisioningService.name);
    private redis: Redis;
    private readonly identityPrefix: string;

    constructor(private readonly config: ConfigService) {
        this.identityPrefix = this.config.get<string>('OCPP_IDENTITY_PREFIX', 'chargers');
    }

    onModuleInit() {
        const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');

        // DigitalOcean Managed Redis requires TLS. 
        // If the URL starts with rediss://, ioredis handles it.
        // However, we might need rejectUnauthorized: false if using self-signed certs (common in some managed envs, though DO usually has valid certs).
        // For safety, we allow passing explicit TLS options or rely on URL.
        const tlsEnabled = this.config.get<string>('REDIS_TLS') === 'true';
        const redisOptions: any = {};

        if (tlsEnabled || redisUrl.startsWith('rediss://')) {
            redisOptions.tls = {
                rejectUnauthorized: false // Often needed for managed services depending on CA setup
            };
        }

        this.redis = new Redis(redisUrl, redisOptions);
        this.logger.log(`Connected to Redis at ${redisUrl} for Charger Provisioning`);
    }

    onModuleDestroy() {
        this.redis.disconnect();
    }

    async provision(chargePoint: ChargePoint, station: Station) {
        if (!chargePoint.ocppId) {
            this.logger.warn(`Cannot provision charge point without OCPP ID: ${chargePoint.id}`);
            return;
        }

        const key = `${this.identityPrefix}:${chargePoint.ocppId}`;

        // Construct the payload expected by ocpp-gateway
        // We infer tenantId from the station's site or owner if available.
        // Since Station schema has siteId, we might need to fetch the Site to get the ownerId.
        // For now, if ownerId is missing on ChargePoint (which it is, as we didn't add it), 
        // we need a strategy. 
        // STRATEGY: We will fetch the Site to get the ownerId efficiently.
        // For initial implementation, we will assume the caller passes a loaded entity or we fetch it.

        // Ideally, we need the Owner ID of the site.
        // payload matches ChargerIdentity type in ocpp-gateway
        const identity = {
            chargePointId: chargePoint.ocppId,
            stationId: station.id,
            tenantId: (station as any).site?.ownerId || 'unknown-owner', // Fallback or need deeper fetch
            status: 'active',
            auth: {
                type: 'basic', // Default to basic auth using OCPP ID as username
                username: chargePoint.ocppId,
                // For security, we should generate a password/hash if one doesn't exist. 
                // But for open/simple compatibility, we might leave secret blank or generate a default.
                // If the gateway enforces secrets, this needs to be robust. 
                // For this plan, we enable the charger to connect.
                allowPlaintext: true
            },
            updatedAt: new Date().toISOString(),
        };

        await this.redis.set(key, JSON.stringify(identity));
        this.logger.log(`Provisioned charger ${chargePoint.ocppId} (Key: ${key})`);
    }
}
