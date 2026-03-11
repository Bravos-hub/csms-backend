import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma, ZoneType } from '@prisma/client';
import * as h3 from 'h3-js';
import {
  CreateGeographicZoneDto,
  GetZonesQueryDto,
  UpdateGeographicZoneDto,
} from './dto/geography.dto';

@Injectable()
export class GeographyService implements OnModuleInit {
  private readonly logger = new Logger(GeographyService.name);
  private readonly allowedChildrenByType: Record<ZoneType, ZoneType[]> = {
    CONTINENT: [ZoneType.SUB_REGION, ZoneType.COUNTRY],
    SUB_REGION: [ZoneType.COUNTRY],
    COUNTRY: [ZoneType.ADM1, ZoneType.CITY, ZoneType.POSTAL_ZONE],
    ADM1: [ZoneType.ADM2, ZoneType.CITY, ZoneType.POSTAL_ZONE],
    ADM2: [ZoneType.ADM3, ZoneType.CITY, ZoneType.POSTAL_ZONE],
    ADM3: [ZoneType.CITY, ZoneType.POSTAL_ZONE],
    CITY: [ZoneType.POSTAL_ZONE],
    POSTAL_ZONE: [],
  };

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaults();
  }

  /**
   * Get H3 hexagon density for coverage layers.
   */
  async getH3Density(resolution: number = 4) {
    try {
      const stations = await this.prisma.station.findMany({
        select: { latitude: true, longitude: true },
      });

      const hexCounts = new Map<string, number>();

      for (const station of stations) {
        const hex = h3.latLngToCell(
          station.latitude,
          station.longitude,
          resolution,
        );
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
        lng: -122.4194,
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
        postalCode: '00100',
      };
    }

    // Default: Return coordinates as "Unknown"
    return {
      lat,
      lng,
      note: 'Location not in mock database',
    };
  }

  /**
   * Get zones, optionally filtering by parent (drill-down).
   */
  async getZones(query: GetZonesQueryDto = {}) {
    try {
      const where: Prisma.GeographicZoneWhereInput = {};
      if (query.parentId !== undefined) {
        where.parentId =
          query.parentId === 'null' || query.parentId === '' ? null : query.parentId;
      }
      if (query.type) {
        where.type = query.type;
      }
      if (typeof query.active === 'boolean') {
        where.isActive = query.active;
      }

      return await this.prisma.geographicZone.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { children: true },
          },
        },
      });
    } catch (error) {
      // Fallback if table doesn't exist yet (migration failure)
      this.logger.error(
        'Failed to fetch zones. Database might not be migrated.',
        error,
      );
      return [];
    }
  }

  /**
   * Generate a binary MVT tile for a given Z/X/Y.
   * Uses PostGIS ST_AsMVT for maximum performance.
   */
  async getMvtTile(
    z: number,
    x: number,
    y: number,
    filters?: { status?: string; type?: string; region?: string },
  ): Promise<Buffer> {
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
        data: { ...c, isActive: true },
      });
    }

    this.logger.log('Seeded default continents');
  }

  async getZoneById(id: string) {
    const zone = await this.prisma.geographicZone.findUnique({
      where: { id },
      include: {
        parent: true,
        _count: {
          select: { children: true, stations: true, sites: true, users: true },
        },
      },
    });
    if (!zone) throw new NotFoundException('Geographic zone not found');
    return zone;
  }

  async createZone(dto: CreateGeographicZoneDto) {
    const data = await this.buildCreateZoneData(dto);
    try {
      return await this.prisma.geographicZone.create({
        data,
        include: {
          parent: true,
          _count: {
            select: { children: true, stations: true, sites: true, users: true },
          },
        },
      });
    } catch (error) {
      this.handleZoneWriteError(error);
    }
  }

  async updateZone(id: string, dto: UpdateGeographicZoneDto) {
    await this.getZoneById(id);
    const data = await this.buildUpdateZoneData(id, dto);
    try {
      return await this.prisma.geographicZone.update({
        where: { id },
        data,
        include: {
          parent: true,
          _count: {
            select: { children: true, stations: true, sites: true, users: true },
          },
        },
      });
    } catch (error) {
      this.handleZoneWriteError(error);
    }
  }

  async setZoneStatus(id: string, isActive: boolean) {
    const zone = await this.getZoneById(id);
    if (!isActive) {
      const activeChildren = await this.prisma.geographicZone.count({
        where: { parentId: id, isActive: true },
      });
      if (activeChildren > 0) {
        throw new BadRequestException(
          'Cannot deactivate a zone while it still has active child zones',
        );
      }
    }

    return this.prisma.geographicZone.update({
      where: { id: zone.id },
      data: { isActive },
      include: {
        parent: true,
        _count: {
          select: { children: true, stations: true, sites: true, users: true },
        },
      },
    });
  }

  private async buildCreateZoneData(
    dto: CreateGeographicZoneDto,
  ): Promise<Prisma.GeographicZoneUncheckedCreateInput> {
    const nextParentId = dto.parentId || null;
    const parent = nextParentId
      ? await this.prisma.geographicZone.findUnique({
          where: { id: nextParentId },
        })
      : null;
    if (nextParentId && !parent) {
      throw new NotFoundException('Parent geographic zone was not found');
    }

    this.assertValidHierarchy(dto.type, parent?.type ?? null);

    return {
      code: dto.code,
      name: dto.name,
      type: dto.type,
      parentId: nextParentId,
      currency: dto.currency ?? null,
      timezone: dto.timezone ?? null,
      postalCodeRegex: dto.postalCodeRegex ?? null,
      isActive: true,
    };
  }

  private async buildUpdateZoneData(
    currentZoneId: string,
    dto: UpdateGeographicZoneDto,
  ): Promise<Prisma.GeographicZoneUncheckedUpdateInput> {
    const currentZone = await this.prisma.geographicZone.findUnique({
      where: { id: currentZoneId },
    });
    if (!currentZone) {
      throw new NotFoundException('Geographic zone not found');
    }

    const parentIdProvided =
      Object.prototype.hasOwnProperty.call(dto, 'parentId') &&
      dto.parentId !== undefined;
    const nextParentId = parentIdProvided ? dto.parentId || null : currentZone.parentId;
    const nextType = dto.type || currentZone.type;

    if (nextParentId === currentZoneId) {
      throw new BadRequestException('A zone cannot be its own parent');
    }

    const parent = nextParentId
      ? await this.prisma.geographicZone.findUnique({
          where: { id: nextParentId },
        })
      : null;
    if (nextParentId && !parent) {
      throw new NotFoundException('Parent geographic zone was not found');
    }

    this.assertValidHierarchy(nextType, parent?.type ?? null);

    if (nextParentId) {
      await this.assertNoCircularParent(currentZoneId, nextParentId);
    }

    const data: Prisma.GeographicZoneUncheckedUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (parentIdProvided) data.parentId = nextParentId;
    if (dto.currency !== undefined) data.currency = dto.currency ?? null;
    if (dto.timezone !== undefined) data.timezone = dto.timezone ?? null;
    if (dto.postalCodeRegex !== undefined) {
      data.postalCodeRegex = dto.postalCodeRegex ?? null;
    }
    return data;
  }

  private assertValidHierarchy(type: ZoneType, parentType: ZoneType | null) {
    if (!parentType) {
      if (type !== ZoneType.CONTINENT) {
        throw new BadRequestException(
          'Only CONTINENT zones can be created without a parent',
        );
      }
      return;
    }

    const allowedChildren = this.allowedChildrenByType[parentType] || [];
    if (!allowedChildren.includes(type)) {
      throw new BadRequestException(
        `${type} is not a valid child type under ${parentType}`,
      );
    }
  }

  private async assertNoCircularParent(
    zoneId: string,
    candidateParentId: string,
  ) {
    let currentParentId: string | null = candidateParentId;
    while (currentParentId) {
      if (currentParentId === zoneId) {
        throw new BadRequestException(
          'Cannot assign a descendant as the parent of this zone',
        );
      }
      const current: { parentId: string | null } | null =
        await this.prisma.geographicZone.findUnique({
        where: { id: currentParentId },
        select: { parentId: true },
      });
      currentParentId = current?.parentId ?? null;
    }
  }

  private handleZoneWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A geographic zone with that code already exists');
    }
    throw error;
  }
}
