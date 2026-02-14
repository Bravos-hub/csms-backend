import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ChargePoint, Station } from '@prisma/client';

type ChargePointAuthProfile = 'basic' | 'mtls_bootstrap';

type ProvisioningOptions = {
    authProfile?: ChargePointAuthProfile;
    bootstrapTtlMinutes?: number;
    allowedIps?: string[];
    allowedCidrs?: string[];
};

type CertificateBindInput = {
    fingerprint: string;
    subject?: string;
    validFrom?: string;
    validTo?: string;
};

type BootstrapUpdateInput = {
    enabled: boolean;
    ttlMinutes?: number;
    allowedIps?: string[];
    allowedCidrs?: string[];
};

type RedisChargerIdentity = {
    chargePointId: string;
    stationId: string;
    tenantId: string;
    status?: 'active' | 'disabled';
    allowedProtocols?: string[];
    allowedIps?: string[];
    allowedCidrs?: string[];
    auth?: {
        type?: 'basic' | 'token' | 'mtls';
        username?: string;
        hashAlgorithm?: string;
        secretHash?: string;
        secretSalt?: string;
        allowNoAuthBootstrap?: boolean;
        noAuthUntil?: string;
        bootstrapRequireIpAllowlist?: boolean;
        certificates?: Array<{
            fingerprint?: string;
            subject?: string;
            validFrom?: string;
            validTo?: string;
            status?: 'active' | 'revoked';
            chargePointId?: string;
        }>;
    };
    updatedAt?: string;
};

@Injectable()
export class ChargerProvisioningService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ChargerProvisioningService.name);
    private redis: Redis;
    private readonly identityPrefix: string;
    private readonly bootstrapDefaultMinutes: number;
    private readonly bootstrapMaxMinutes: number;

    constructor(private readonly config: ConfigService) {
        this.identityPrefix = this.config.get<string>('OCPP_IDENTITY_PREFIX', 'chargers');
        this.bootstrapDefaultMinutes = this.readIntEnv('OCPP_NOAUTH_BOOTSTRAP_DEFAULT_MINUTES', 30);
        this.bootstrapMaxMinutes = this.readIntEnv('OCPP_NOAUTH_BOOTSTRAP_MAX_MINUTES', 120);
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

    async provision(
        chargePoint: ChargePoint,
        station: Station,
        ocppVersion: '1.6' | '2.0.1' | '2.1' = '1.6',
        options?: ProvisioningOptions
    ) {
        if (!chargePoint.ocppId) {
            this.logger.warn(`Cannot provision charge point without OCPP ID: ${chargePoint.id}`);
            return;
        }

        const key = `${this.identityPrefix}:${chargePoint.ocppId}`;
        const existing = await this.getIdentity(chargePoint.ocppId);
        const existingAuth = existing?.auth || {};
        const requestedProfile = options?.authProfile;
        const authProfile: ChargePointAuthProfile =
            requestedProfile
                || (existingAuth.allowNoAuthBootstrap ? 'mtls_bootstrap' : 'basic');
        const allowedIps =
            options?.allowedIps !== undefined
                ? this.normalizeList(options.allowedIps)
                : this.normalizeList(existing?.allowedIps);
        const allowedCidrs =
            options?.allowedCidrs !== undefined
                ? this.normalizeList(options.allowedCidrs)
                : this.normalizeList(existing?.allowedCidrs);
        const bootstrapTtl = this.resolveBootstrapTtl(options?.bootstrapTtlMinutes);
        const noAuthUntil = new Date(Date.now() + bootstrapTtl * 60_000).toISOString();

        const auth: NonNullable<RedisChargerIdentity['auth']> = {
            ...existingAuth,
            type: (existingAuth.type === 'mtls' && !requestedProfile) ? 'mtls' : 'basic',
            username: chargePoint.ocppId,
            hashAlgorithm: 'sha256',
            secretHash: chargePoint.clientSecretHash || existingAuth.secretHash || undefined,
            secretSalt: chargePoint.clientSecretSalt || existingAuth.secretSalt || undefined,
        };

        if (requestedProfile === 'mtls_bootstrap') {
            auth.type = 'basic';
            auth.allowNoAuthBootstrap = true;
            auth.noAuthUntil = noAuthUntil;
            auth.bootstrapRequireIpAllowlist = true;
        } else if (requestedProfile === 'basic') {
            auth.allowNoAuthBootstrap = false;
            delete auth.noAuthUntil;
            delete auth.bootstrapRequireIpAllowlist;
        }

        const identity: RedisChargerIdentity = {
            chargePointId: chargePoint.ocppId,
            stationId: station.id,
            tenantId: (station as any).site?.ownerId || 'unknown-owner', // Fallback or need deeper fetch
            status: 'active',
            allowedProtocols: [this.gatewayVersion(ocppVersion)],
            allowedIps,
            allowedCidrs,
            auth,
            updatedAt: new Date().toISOString(),
        };

        await this.redis.set(key, JSON.stringify(identity));
        this.logger.log(`Provisioned charger ${chargePoint.ocppId} (${authProfile}) (Key: ${key})`);
    }

    async bindCertificate(chargePointId: string, input: CertificateBindInput): Promise<RedisChargerIdentity> {
        const identity = await this.getIdentityOrThrow(chargePointId);
        const auth: NonNullable<RedisChargerIdentity['auth']> = identity.auth || {};
        const normalized = this.normalizeFingerprint(input.fingerprint);

        auth.certificates = (auth.certificates || []).filter((entry) => {
            if (!entry.fingerprint) return true;
            return this.normalizeFingerprint(entry.fingerprint) !== normalized;
        });

        auth.certificates.push({
            fingerprint: normalized,
            subject: input.subject,
            validFrom: input.validFrom || new Date().toISOString(),
            validTo: input.validTo,
            status: 'active',
            chargePointId,
        });

        auth.type = 'mtls';
        auth.allowNoAuthBootstrap = false;
        delete auth.noAuthUntil;
        delete auth.bootstrapRequireIpAllowlist;
        identity.auth = auth;
        identity.updatedAt = new Date().toISOString();

        await this.redis.set(this.identityKey(chargePointId), JSON.stringify(identity));
        return identity;
    }

    async getSecurityState(chargePointId: string): Promise<{
        authProfile: 'basic' | 'mtls_bootstrap' | 'mtls';
        bootstrapEnabled: boolean;
        bootstrapExpiresAt?: string;
        allowedIps: string[];
        allowedCidrs: string[];
        requiresClientCertificate: boolean;
        certificatesCount: number;
    }> {
        const identity = await this.getIdentity(chargePointId);
        if (!identity) {
            return {
                authProfile: 'basic',
                bootstrapEnabled: false,
                allowedIps: [],
                allowedCidrs: [],
                requiresClientCertificate: false,
                certificatesCount: 0,
            };
        }

        const auth: NonNullable<RedisChargerIdentity['auth']> = identity.auth || {};
        const profile = auth.type === 'mtls'
            ? 'mtls'
            : auth.allowNoAuthBootstrap
                ? 'mtls_bootstrap'
                : 'basic';

        return {
            authProfile: profile,
            bootstrapEnabled: auth.allowNoAuthBootstrap === true,
            bootstrapExpiresAt: auth.noAuthUntil,
            allowedIps: this.normalizeList(identity.allowedIps),
            allowedCidrs: this.normalizeList(identity.allowedCidrs),
            requiresClientCertificate: profile !== 'basic',
            certificatesCount: auth.certificates?.length || 0,
        };
    }

    async updateBootstrap(chargePointId: string, input: BootstrapUpdateInput): Promise<RedisChargerIdentity> {
        const identity = await this.getIdentityOrThrow(chargePointId);
        const auth: NonNullable<RedisChargerIdentity['auth']> = identity.auth || {};

        const allowedIps =
            input.allowedIps !== undefined
                ? this.normalizeList(input.allowedIps)
                : this.normalizeList(identity.allowedIps);
        const allowedCidrs =
            input.allowedCidrs !== undefined
                ? this.normalizeList(input.allowedCidrs)
                : this.normalizeList(identity.allowedCidrs);

        if (input.enabled) {
            if (allowedIps.length === 0 && allowedCidrs.length === 0) {
                throw new Error('Bootstrap allowlist is required (allowedIps or allowedCidrs)');
            }
            auth.type = 'basic';
            auth.allowNoAuthBootstrap = true;
            auth.noAuthUntil = new Date(
                Date.now() + this.resolveBootstrapTtl(input.ttlMinutes) * 60_000
            ).toISOString();
            auth.bootstrapRequireIpAllowlist = true;
            identity.allowedIps = allowedIps;
            identity.allowedCidrs = allowedCidrs;
        } else {
            auth.allowNoAuthBootstrap = false;
            delete auth.noAuthUntil;
        }

        identity.auth = auth;
        identity.updatedAt = new Date().toISOString();
        await this.redis.set(this.identityKey(chargePointId), JSON.stringify(identity));
        return identity;
    }

    private gatewayVersion(version: '1.6' | '2.0.1' | '2.1'): '1.6J' | '2.0.1' | '2.1' {
        if (version === '2.0.1' || version === '2.1') return version;
        return '1.6J';
    }

    private async getIdentity(chargePointId: string): Promise<RedisChargerIdentity | null> {
        const raw = await this.redis.get(this.identityKey(chargePointId));
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw) as RedisChargerIdentity;
        } catch {
            return null;
        }
    }

    private async getIdentityOrThrow(chargePointId: string): Promise<RedisChargerIdentity> {
        const identity = await this.getIdentity(chargePointId);
        if (!identity) {
            throw new Error(`Identity not found for ${chargePointId}`);
        }
        return identity;
    }

    private identityKey(chargePointId: string): string {
        return `${this.identityPrefix}:${chargePointId}`;
    }

    private normalizeList(values?: string[]): string[] {
        if (!values || values.length === 0) return [];
        return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)));
    }

    private normalizeFingerprint(value: string): string {
        return value.replace(/:/g, '').trim().toUpperCase();
    }

    private resolveBootstrapTtl(input?: number): number {
        const fallback = Number.isFinite(input as number) ? Number(input) : this.bootstrapDefaultMinutes;
        const floor = Math.max(1, Math.floor(fallback));
        const max = Math.max(1, this.bootstrapMaxMinutes);
        return Math.min(floor, max);
    }

    private readIntEnv(key: string, fallback: number): number {
        const raw = this.config.get<string>(key);
        if (!raw) return fallback;
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
}
