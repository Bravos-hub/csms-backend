import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  InternalServerErrorException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma, ZoneType } from '@prisma/client';
import * as h3 from 'h3-js';
import {
  CreateGeographicZoneDto,
  GetZonesQueryDto,
  UpdateGeographicZoneDto,
} from './dto/geography.dto';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type GeographyCountryReference = {
  code2: string;
  code3: string | null;
  name: string;
  officialName: string | null;
  flagUrl: string | null;
  currencyCode: string | null;
  currencyName: string | null;
  currencySymbol: string | null;
  languages: string[];
};

type GeographyStateReference = {
  countryCode: string;
  code: string;
  name: string;
};

type GeographyCityReference = {
  countryCode: string;
  stateCode: string;
  name: string;
};

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(input || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function normalizeCode(input: string, maxLen = 32): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

@Injectable()
export class GeographyService implements OnModuleInit {
  private readonly logger = new Logger(GeographyService.name);
  private readonly referenceCacheTtlMs =
    parsePositiveInt(process.env.GEOGRAPHY_REFERENCE_CACHE_TTL_MINUTES, 720) *
    60_000;
  private readonly referenceRequestTimeoutMs = parsePositiveInt(
    process.env.GEOGRAPHY_REFERENCE_REQUEST_TIMEOUT_MS,
    10_000,
  );
  private readonly restCountriesBaseUrl =
    process.env.GEOGRAPHY_REST_COUNTRIES_BASE_URL ||
    'https://restcountries.com/v3.1';
  private readonly cscBaseUrl =
    process.env.GEOGRAPHY_CSC_BASE_URL ||
    process.env.CSC_API_BASE_URL ||
    'https://api.countrystatecity.in/v1';
  private readonly cscApiKey =
    process.env.GEOGRAPHY_CSC_API_KEY || process.env.CSC_API_KEY || '';
  private readonly ipapiBaseUrl =
    process.env.GEOGRAPHY_IPAPI_BASE_URL || 'https://ipapi.co';
  private readonly ipapiApiKey = process.env.GEOGRAPHY_IPAPI_KEY || '';
  private readonly openCageBaseUrl =
    process.env.GEOGRAPHY_OPENCAGE_BASE_URL ||
    'https://api.opencagedata.com/geocode/v1';
  private readonly openCageApiKey =
    process.env.GEOGRAPHY_OPENCAGE_API_KEY || '';

  private countriesCache: CacheEntry<GeographyCountryReference[]> | null = null;
  private readonly statesCache = new Map<
    string,
    CacheEntry<GeographyStateReference[]>
  >();
  private readonly citiesCache = new Map<
    string,
    CacheEntry<GeographyCityReference[]>
  >();

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
   * Auto-detect location from IP address using ipapi.co.
   */
  async detectLocationFromIp(ip: string) {
    if (!this.ipapiApiKey) {
      throw new ServiceUnavailableException(
        'IP geolocation provider is not configured. Set GEOGRAPHY_IPAPI_KEY to enable IP-based detection.',
      );
    }

    const normalizedIp = this.normalizeClientIp(ip);
    if (!normalizedIp) {
      throw new BadRequestException('A valid client IP address is required');
    }

    const url =
      `${this.ipapiBaseUrl}/${encodeURIComponent(normalizedIp)}/json/` +
      `?key=${encodeURIComponent(this.ipapiApiKey)}`;
    const payload = await this.fetchJson<unknown>(url);
    const record = asRecord(payload);

    const countryCode = normalizeCode(
      readString(record, 'country_code') || '',
      2,
    );
    const countryName = (readString(record, 'country_name') || '').trim();
    if (!countryCode || !countryName) {
      throw new ServiceUnavailableException(
        'IP geolocation provider returned incomplete location data',
      );
    }

    const rawRegionCode = (readString(record, 'region_code') || '').trim();
    const regionCode =
      rawRegionCode.length > 0
        ? `${countryCode}-${normalizeCode(rawRegionCode, 16)}`
        : null;
    const latitude = this.readFiniteNumber(record?.latitude ?? record?.lat);
    const longitude = this.readFiniteNumber(record?.longitude ?? record?.lon);

    return {
      countryCode,
      countryName,
      regionCode,
      regionName: readString(record, 'region') || null,
      city: readString(record, 'city') || null,
      postalCode: readString(record, 'postal') || null,
      lat: latitude,
      lng: longitude,
    };
  }

  /**
   * Reverse geocode coordinates using OpenCage.
   */
  async reverseGeocode(lat: number, lng: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException(
        'Valid lat and lng query parameters are required',
      );
    }
    if (!this.openCageApiKey) {
      throw new ServiceUnavailableException(
        'Reverse geocoding provider is not configured. Set GEOGRAPHY_OPENCAGE_API_KEY to enable reverse geocoding.',
      );
    }

    const query = encodeURIComponent(`${lat},${lng}`);
    const url =
      `${this.openCageBaseUrl}/json?q=${query}` +
      `&key=${encodeURIComponent(this.openCageApiKey)}` +
      '&no_annotations=1&limit=1';
    const payload = await this.fetchJson<unknown>(url);
    const root = asRecord(payload);
    const results = Array.isArray(root?.results) ? root.results : [];
    const first = asRecord(results[0]);
    const components = asRecord(first?.components);
    if (!first || !components) {
      throw new NotFoundException('No address found for provided coordinates');
    }

    const countryCode = normalizeCode(
      readString(components, 'country_code') || '',
      2,
    );
    const countryName = (readString(components, 'country') || '').trim();
    if (!countryCode || !countryName) {
      throw new ServiceUnavailableException(
        'Reverse geocoding provider returned incomplete location data',
      );
    }

    const adm1 =
      readString(components, 'state') ||
      readString(components, 'region') ||
      readString(components, 'county') ||
      null;
    const city =
      readString(components, 'city') ||
      readString(components, 'town') ||
      readString(components, 'village') ||
      readString(components, 'municipality') ||
      readString(components, 'county') ||
      null;
    const adm1Type =
      adm1 && readString(components, 'state')
        ? 'State'
        : adm1 && readString(components, 'region')
          ? 'Region'
          : adm1 && readString(components, 'county')
            ? 'County'
            : null;

    return {
      countryCode,
      countryName,
      adm1,
      adm1Type,
      city,
      postalCode: readString(components, 'postcode') || null,
      lat,
      lng,
      formatted: readString(first, 'formatted') || null,
    };
  }

  async getReferenceCountries(query: { refresh?: boolean; q?: string } = {}) {
    const refresh = Boolean(query.refresh);
    const search = (query.q || '').trim().toLowerCase();

    if (!refresh && this.isCacheValid(this.countriesCache)) {
      return this.filterCountriesByQuery(this.countriesCache.value, search);
    }

    const url =
      `${this.restCountriesBaseUrl}/all` +
      '?fields=name,cca2,cca3,flags,currencies,languages';

    const payload = await this.fetchJson<unknown>(url);
    const rows = Array.isArray(payload) ? payload : [];

    const mapped = rows
      .map((row) => this.mapCountryReference(row))
      .filter((item): item is GeographyCountryReference => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.countriesCache = {
      value: mapped,
      expiresAt: Date.now() + this.referenceCacheTtlMs,
    };

    return this.filterCountriesByQuery(mapped, search);
  }

  async getReferenceStates(
    countryCode: string,
    query: { refresh?: boolean } = {},
  ) {
    const normalizedCountryCode = normalizeCode(countryCode, 3);
    if (!normalizedCountryCode) {
      throw new BadRequestException('countryCode is required');
    }

    if (!this.cscApiKey) {
      throw new ServiceUnavailableException(
        'Country State City provider is not configured. Set CSC_API_KEY to enable states and cities lookups.',
      );
    }

    const refresh = Boolean(query.refresh);
    if (!refresh) {
      const cached = this.statesCache.get(normalizedCountryCode);
      if (this.isCacheValid(cached)) {
        return cached.value;
      }
    }

    const url = `${this.cscBaseUrl}/countries/${encodeURIComponent(
      normalizedCountryCode,
    )}/states`;
    const rows = await this.fetchJson<unknown[]>(url, {
      headers: this.buildCscHeaders(),
    });

    const mapped = (Array.isArray(rows) ? rows : [])
      .map((row) => this.mapStateReference(row, normalizedCountryCode))
      .filter((item): item is GeographyStateReference => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.statesCache.set(normalizedCountryCode, {
      value: mapped,
      expiresAt: Date.now() + this.referenceCacheTtlMs,
    });
    return mapped;
  }

  async getReferenceCities(
    countryCode: string,
    stateCode: string,
    query: { refresh?: boolean } = {},
  ) {
    const normalizedCountryCode = normalizeCode(countryCode, 3);
    const normalizedStateCode = normalizeCode(stateCode, 32);
    if (!normalizedCountryCode) {
      throw new BadRequestException('countryCode is required');
    }
    if (!normalizedStateCode) {
      throw new BadRequestException('stateCode is required');
    }

    if (!this.cscApiKey) {
      throw new ServiceUnavailableException(
        'Country State City provider is not configured. Set CSC_API_KEY to enable states and cities lookups.',
      );
    }

    const cacheKey = `${normalizedCountryCode}:${normalizedStateCode}`;
    const refresh = Boolean(query.refresh);
    if (!refresh) {
      const cached = this.citiesCache.get(cacheKey);
      if (this.isCacheValid(cached)) {
        return cached.value;
      }
    }

    const url = `${this.cscBaseUrl}/countries/${encodeURIComponent(
      normalizedCountryCode,
    )}/states/${encodeURIComponent(normalizedStateCode)}/cities`;
    const rows = await this.fetchJson<unknown[]>(url, {
      headers: this.buildCscHeaders(),
    });

    const mapped = (Array.isArray(rows) ? rows : [])
      .map((row) =>
        this.mapCityReference(row, normalizedCountryCode, normalizedStateCode),
      )
      .filter((item): item is GeographyCityReference => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.citiesCache.set(cacheKey, {
      value: mapped,
      expiresAt: Date.now() + this.referenceCacheTtlMs,
    });
    return mapped;
  }

  /**
   * Get zones, optionally filtering by parent (drill-down).
   */
  async getZones(query: GetZonesQueryDto = {}) {
    try {
      const where: Prisma.GeographicZoneWhereInput = {};
      if (query.parentId !== undefined) {
        where.parentId =
          query.parentId === 'null' || query.parentId === ''
            ? null
            : query.parentId;
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
      const params: Array<number | string> = [xMin, yMin, xMax, yMax];
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

      const result = await this.prisma.$queryRawUnsafe<
        Array<{ mvt: Buffer | Uint8Array | null }>
      >(query, ...params);

      if (!result || result.length === 0 || !result[0].mvt) {
        return Buffer.alloc(0);
      }

      const tile = result[0].mvt;
      return Buffer.isBuffer(tile) ? tile : Buffer.from(tile);
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
            select: {
              children: true,
              stations: true,
              sites: true,
              users: true,
            },
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
            select: {
              children: true,
              stations: true,
              sites: true,
              users: true,
            },
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
    const nextParentId = parentIdProvided
      ? dto.parentId || null
      : currentZone.parentId;
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
      throw new ConflictException(
        'A geographic zone with that code already exists',
      );
    }
    throw error;
  }

  private normalizeClientIp(raw: string): string | null {
    const first = raw.split(',')[0]?.trim() || '';
    if (!first) {
      return null;
    }

    const normalized =
      first.startsWith('::ffff:') && first.length > '::ffff:'.length
        ? first.slice('::ffff:'.length)
        : first;
    return normalized.length > 0 ? normalized : null;
  }

  private readFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.referenceRequestTimeoutMs,
    );

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const message =
          body?.trim() || `Provider responded with HTTP ${response.status}`;
        throw new ServiceUnavailableException(message);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Geography reference provider request failed: ${url}`,
        error,
      );
      throw new ServiceUnavailableException(
        'Failed to fetch geography reference data from provider',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private isCacheValid<T>(
    entry: CacheEntry<T> | null | undefined,
  ): entry is CacheEntry<T> {
    return Boolean(entry && entry.expiresAt > Date.now());
  }

  private filterCountriesByQuery(
    countries: GeographyCountryReference[],
    search: string,
  ) {
    if (!search) return countries;
    return countries.filter((country) => {
      const languageHit = country.languages.some((language) =>
        language.toLowerCase().includes(search),
      );
      return (
        country.name.toLowerCase().includes(search) ||
        country.code2.toLowerCase().includes(search) ||
        country.code3?.toLowerCase().includes(search) ||
        country.currencyCode?.toLowerCase().includes(search) ||
        languageHit
      );
    });
  }

  private mapCountryReference(row: unknown): GeographyCountryReference | null {
    const record = asRecord(row);
    const nameRecord = asRecord(record?.['name']);
    const flagsRecord = asRecord(record?.['flags']);
    const currenciesRecord = asRecord(record?.['currencies']);
    const languagesRecord = asRecord(record?.['languages']);

    const code2 = normalizeCode(readString(record, 'cca2') || '', 2);
    const code3 = normalizeCode(readString(record, 'cca3') || '', 3) || null;
    const name = readString(nameRecord, 'common')?.trim() || '';
    const officialName = readString(nameRecord, 'official')?.trim() || null;
    if (!code2 || !name) return null;

    let currencyCode: string | null = null;
    let currencyName: string | null = null;
    let currencySymbol: string | null = null;

    if (currenciesRecord) {
      const currencyCodes = Object.keys(currenciesRecord);
      if (currencyCodes.length > 0) {
        currencyCode = normalizeCode(currencyCodes[0], 8) || null;
        const currencyMeta = asRecord(currenciesRecord[currencyCodes[0]]);
        currencyName = readString(currencyMeta, 'name') || null;
        currencySymbol = readString(currencyMeta, 'symbol') || null;
      }
    }

    const languages = languagesRecord
      ? Object.values(languagesRecord).filter(
          (language): language is string => typeof language === 'string',
        )
      : [];

    return {
      code2,
      code3,
      name,
      officialName,
      flagUrl:
        readString(flagsRecord, 'svg') ||
        readString(flagsRecord, 'png') ||
        null,
      currencyCode,
      currencyName,
      currencySymbol,
      languages,
    };
  }

  private mapStateReference(
    row: unknown,
    fallbackCountryCode: string,
  ): GeographyStateReference | null {
    const record = asRecord(row);
    const name = (readString(record, 'name') || '').trim();
    if (!name) return null;

    const countryCode =
      normalizeCode(readString(record, 'country_code') || '', 3) ||
      fallbackCountryCode;
    const code =
      normalizeCode(readString(record, 'iso2') || '', 32) ||
      normalizeCode(readString(record, 'state_code') || '', 32) ||
      normalizeCode(name, 32);
    if (!code) return null;

    return {
      countryCode,
      code,
      name,
    };
  }

  private mapCityReference(
    row: unknown,
    countryCode: string,
    stateCode: string,
  ): GeographyCityReference | null {
    const record = asRecord(row);
    const name = (readString(record, 'name') || '').trim();
    if (!name) return null;

    return {
      countryCode,
      stateCode,
      name,
    };
  }

  private buildCscHeaders(): HeadersInit {
    return {
      Accept: 'application/json',
      'X-CSCAPI-KEY': this.cscApiKey,
    };
  }
}
