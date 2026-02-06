import { Injectable, Logger, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ZoneType } from '@prisma/client';
import * as h3 from 'h3-js';

@Injectable()
export class GeographyService implements OnModuleInit {
    private readonly logger = new Logger(GeographyService.name);

    constructor(private readonly prisma: PrismaService) { }

    async onModuleInit() {
        await this.seedDefaults();
    }

    /**
     * Get H3 hexagon density for coverage layers.
     */
    async getH3Density(resolution: number = 4) {
        try {
            const stations = await this.prisma.station.findMany({
                select: { latitude: true, longitude: true }
            });

            const hexCounts = new Map<string, number>();

            for (const station of stations) {
                const hex = h3.latLngToCell(station.latitude, station.longitude, resolution);
                hexCounts.set(hex, (hexCounts.get(hex) || 0) + 1);
            }

            return Array.from(hexCounts.entries()).map(([hex, count]) => ({
                hex,
                count,
                // boundary: h3.cellToBoundary(hex).map(([lat, lng]) => [lng, lat]) // lng, lat for MapLibre
            }));
        } catch (error) {
            this.logger.error('Failed to generate H3 density', error);
            throw new InternalServerErrorException('Failed to generate density data');
        }
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
     * Generate a binary MVT tile for a given Z/X/Y.
     * Uses PostGIS ST_AsMVT for maximum performance.
     */
    async getMvtTile(z: number, x: number, y: number, filters?: { status?: string, type?: string, region?: string }): Promise<Buffer> {
        try {
            // 1. Calculate the bounding box for the tile in Web Mercator (3857)
            const worldSize = 40075016.68557849;
            const tileSize = worldSize / Math.pow(2, z);
            const xMin = -worldSize / 2 + x * tileSize;
            const xMax = xMin + tileSize;
            const yMax = worldSize / 2 - y * tileSize;
            const yMin = yMax - tileSize;

            // 2. Build filter clauses
            let filterSql = '';
            const params: any[] = [xMin, yMin, xMax, yMax];
            let paramIdx = 5;

            if (filters?.status && filters.status !== 'All') {
                filterSql += ` AND status = $${paramIdx++}`;
                params.push(filters.status.toUpperCase());
            }
            if (filters?.type && filters.type !== 'All') {
                filterSql += ` AND type = $${paramIdx++}`;
                params.push(filters.type.toUpperCase());
            }
            if (filters?.region && filters.region !== 'ALL') {
                filterSql += ` AND region = $${paramIdx++}`;
                params.push(filters.region.toUpperCase());
            }

            // 3. Execute raw SQL to fetch points as MVT
            const query = `
                WITH bounds AS (
                    SELECT ST_MakeEnvelope($1, $2, $3, $4, 3857) AS geom
                ),
                mvt_geom AS (
                    SELECT 
                        id, name, status, type,
                        ST_AsMVTGeom(
                            ST_Transform(ST_SetSRID(ST_Point(longitude, latitude), 4326), 3857),
                            bounds.geom,
                            4096, 64, true
                        ) AS geom
                    FROM stations, bounds
                    WHERE ST_Intersects(
                        ST_Transform(ST_SetSRID(ST_Point(longitude, latitude), 4326), 3857), 
                        bounds.geom
                    ) ${filterSql}
                )
                SELECT ST_AsMVT(mvt_geom.*, 'stations') AS mvt FROM mvt_geom;
            `;

            const result: any[] = await this.prisma.$queryRawUnsafe(query, ...params);

            if (!result || result.length === 0 || !result[0].mvt) {
                return Buffer.alloc(0);
            }

            return result[0].mvt;
        } catch (error) {
            this.logger.error(`MVT Generation failed for ${z}/${x}/${y}`, error);
            throw new InternalServerErrorException('Tile generation failed');
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
