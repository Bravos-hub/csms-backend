import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ZoneType } from '@prisma/client';

@Injectable()
export class GeographyService implements OnModuleInit {
    private readonly logger = new Logger(GeographyService.name);

    constructor(private readonly prisma: PrismaService) { }

    async onModuleInit() {
        await this.seedDefaults();
    }

    /**
     * Auto-detect location from IP address.
     * Mock implementation for now.
     */
    async detectLocationFromIp(ip: string) {
        // In a real app, use MaxMind or an IP-API here.
        // For prototype, return a default or random location based on simple logic

        // Simulate "US" user
        if (ip.startsWith('192.168') || ip.startsWith('10.')) {
            return {
                countryCode: 'US',
                countryName: 'United States',
                regionCode: 'US-CA',
                regionName: 'California',
                city: 'San Francisco',
                postalCode: '94105',
                lat: 37.7749,
                lng: -122.4194
            };
        }

        return null;
    }

    /**
     * Reverse geocode a lat/long to a standardized address.
     * This is the "Magic" for mobile users.
     */
    async reverseGeocode(lat: number, lng: number) {
        // Mock implementation. 
        // In production, integrate Google Maps API or OpenCage.

        // Example: Nairobi, Kenya
        if (lat > -1.5 && lat < -1.0 && lng > 36.5 && lng < 37.0) {
            return {
                countryCode: 'KE',
                countryName: 'Kenya',
                adm1: 'Nairobi', // County
                adm1Type: 'County',
                city: 'Nairobi',
                postalCode: '00100'
            };
        }

        // Default: Return coordinates as "Unknown"
        return {
            lat,
            lng,
            note: 'Location not in mock database'
        };
    }

    /**
     * Get zones, optionally filtering by parent (drill-down).
     */
    async getZones(parentId?: string | null, type?: ZoneType) {
        try {
            const where: any = {};
            if (parentId !== undefined) {
                where.parentId = parentId;
            }
            if (type) {
                where.type = type;
            }

            return await this.prisma.geographicZone.findMany({
                where,
                orderBy: { name: 'asc' },
                include: {
                    _count: {
                        select: { children: true }
                    }
                }
            });
        } catch (error) {
            // Fallback if table doesn't exist yet (migration failure)
            this.logger.error('Failed to fetch zones. Database might not be migrated.', error);
            return [];
        }
    }

    /**
     * Seed minimal required data if empty.
     */
    async seedDefaults() {
        const count = await this.prisma.geographicZone.count();
        if (count > 0) return;

        // Seed Continents
        const continents = [
            { name: 'Africa', code: 'AF', type: ZoneType.CONTINENT },
            { name: 'North America', code: 'NA', type: ZoneType.CONTINENT },
            { name: 'Europe', code: 'EU', type: ZoneType.CONTINENT },
            { name: 'Asia', code: 'AS', type: ZoneType.CONTINENT },
        ];

        for (const c of continents) {
            await this.prisma.geographicZone.create({
                data: { ...c }
            });
        }

        this.logger.log('Seeded default continents');
    }
}
