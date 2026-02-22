import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { URL } from 'url';
import * as fs from 'fs';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    constructor() {
        const connectionString = process.env.DATABASE_URL;

        if (!connectionString) {
            throw new Error('DATABASE_URL environment variable is not set');
        }

        const validatedUrl = PrismaService.validateDatabaseUrl(connectionString);
        const urlObj = new URL(validatedUrl);
        urlObj.searchParams.delete('sslmode');

        const tlsEnabled =
            (process.env.DATABASE_TLS ?? 'false') === 'true'
            || ['require', 'verify-ca', 'verify-full'].includes(
                (new URL(validatedUrl).searchParams.get('sslmode') || '').toLowerCase(),
            );
        const rejectUnauthorized = (process.env.DATABASE_TLS_REJECT_UNAUTHORIZED ?? 'true') === 'true';
        if (tlsEnabled && !rejectUnauthorized) {
            throw new Error('DATABASE_TLS_REJECT_UNAUTHORIZED=false is not allowed');
        }
        const caPath = process.env.DATABASE_TLS_CA_PATH;
        if (caPath && !fs.existsSync(caPath)) {
            throw new Error(`DATABASE_TLS_CA_PATH not found: ${caPath}`);
        }

        const pool = new Pool({
            connectionString: urlObj.toString(),
            ssl: tlsEnabled
                ? {
                    rejectUnauthorized: true,
                    ca: caPath ? fs.readFileSync(caPath, 'utf8') : undefined,
                }
                : undefined,
        });
        const adapter = new PrismaPg(pool);
        super({ adapter });
    }

    private static validateDatabaseUrl(url: string): string {
        try {
            const parsedUrl = new URL(url);

            if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
                throw new Error('Invalid database protocol. Only postgresql:// is allowed');
            }

            const hostname = parsedUrl.hostname;
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                if (process.env.NODE_ENV === 'production') {
                    throw new Error('Localhost database connections not allowed in production');
                }
            }

            const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
            const match = hostname.match(ipv4Regex);
            if (match) {
                const [, a, b] = match.map(Number);
                if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
                    if (process.env.NODE_ENV === 'production') {
                        throw new Error('Private IP ranges not allowed in production');
                    }
                }
            }

            return url;
        } catch (error) {
            throw new Error(`Invalid DATABASE_URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}

