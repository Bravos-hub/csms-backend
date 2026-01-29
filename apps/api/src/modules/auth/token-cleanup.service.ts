import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class TokenCleanupService {
    private readonly logger = new Logger(TokenCleanupService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Run daily at 2 AM to clean up expired/revoked refresh tokens
     * This prevents database bloat and maintains query performance
     */
    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async cleanupExpiredTokens() {
        this.logger.log('Starting cleanup of expired/revoked refresh tokens');

        try {
            const result = await this.prisma.refreshToken.deleteMany({
                where: {
                    OR: [
                        { expiresAt: { lt: new Date() } }, // Expired tokens
                        { revokedAt: { not: null } }, // Revoked tokens
                    ],
                },
            });

            this.logger.log(`Cleanup complete: ${result.count} tokens removed`);
            return { success: true, tokensRemoved: result.count };
        } catch (error) {
            this.logger.error('Token cleanup failed', error);
            throw error;
        }
    }

    /**
     * Manual cleanup trigger (for testing or admin operations)
     */
    async manualCleanup() {
        this.logger.log('Manual cleanup triggered');
        return this.cleanupExpiredTokens();
    }

    /**
     * Get cleanup statistics
     */
    async getCleanupStats() {
        const total = await this.prisma.refreshToken.count();
        const expired = await this.prisma.refreshToken.count({
            where: { expiresAt: { lt: new Date() } },
        });
        const revoked = await this.prisma.refreshToken.count({
            where: { revokedAt: { not: null } },
        });
        const active = await this.prisma.refreshToken.count({
            where: {
                expiresAt: { gt: new Date() },
                revokedAt: null,
            },
        });

        return {
            total,
            expired,
            revoked,
            active,
            needsCleanup: expired + revoked,
        };
    }
}
