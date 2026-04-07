import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ChargePoint } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  OcpiPartnerCreateRequestDto,
  OcpiPartnerListQueryDto,
  OcpiPartnerUpdateRequestDto,
  OcpiRoamingListQueryDto,
} from './dto/ocpi.dto';

type RoamingListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

@Injectable()
export class OcpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findAllPartners(query: OcpiPartnerListQueryDto) {
    const where: Prisma.OcpiPartnerWhereInput = {};
    if (query.status) where.status = query.status.toUpperCase();
    if (query.role) where.role = query.role.toUpperCase();
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { partyId: { contains: query.q, mode: 'insensitive' } },
        { countryCode: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.ocpiPartner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((partner) => {
      const endpoints = this.ensureArray(partner.endpoints);
      const modules = this.extractPartnerModules(endpoints);
      return {
        id: partner.id,
        name: partner.name,
        partyId: partner.partyId,
        countryCode: partner.countryCode,
        role: String(partner.role || 'OTHER').toUpperCase(),
        status: this.mapPartnerStatus(partner.status),
        statusRaw: partner.status,
        modules,
        version: partner.version || '2.2.1',
        endpoint: partner.versionsUrl || null,
        lastSync: partner.lastSyncAt ? partner.lastSyncAt.toISOString() : null,
        lastSyncAt: partner.lastSyncAt
          ? partner.lastSyncAt.toISOString()
          : null,
        capabilities: {
          roles: this.ensureArray(partner.roles),
          endpoints,
        },
        createdAt: partner.createdAt.toISOString(),
        updatedAt: partner.updatedAt.toISOString(),
      };
    });
  }

  async createPartner(payload: OcpiPartnerCreateRequestDto) {
    const created = await this.prisma.ocpiPartner.create({
      data: {
        name: payload.name,
        partyId: payload.partyId.toUpperCase(),
        countryCode: payload.countryCode.toUpperCase(),
        role: payload.role.toUpperCase(),
        status: 'PENDING',
        versionsUrl: payload.versionsUrl || null,
        tokenA: payload.tokenA || null,
        tokenB: payload.tokenB || null,
        tokenC: payload.tokenC || null,
      },
    });
    return created;
  }

  async updatePartner(id: string, payload: OcpiPartnerUpdateRequestDto) {
    return this.prisma.ocpiPartner.update({
      where: { id },
      data: {
        name: payload.name,
        role: payload.role ? payload.role.toUpperCase() : undefined,
        status: payload.status ? payload.status.toUpperCase() : undefined,
        versionsUrl: payload.versionsUrl,
        roles: payload.roles
          ? (payload.roles as Prisma.InputJsonValue)
          : payload.roles,
        endpoints: payload.endpoints
          ? (payload.endpoints as Prisma.InputJsonValue)
          : payload.endpoints,
      },
    });
  }

  async suspendPartner(id: string) {
    return this.prisma.ocpiPartner.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });
  }

  async syncPartner(id: string) {
    return this.prisma.ocpiPartner.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        status: 'ACTIVE',
      },
    });
  }

  async getRoamingSessions(query: OcpiRoamingListQueryDto): Promise<
    RoamingListResponse<{
      id: string;
      role: 'CPO' | 'MSP';
      partner: string;
      site: string;
      cp: string;
      start: string;
      end: string | null;
      dur: string;
      kwh: number;
      cur: string;
      amt: number;
      status: 'Completed' | 'Charging' | 'Failed' | 'Refunded';
      raw: Record<string, unknown>;
    }>
  > {
    const rows = await this.prisma.ocpiPartnerSession.findMany({
      orderBy: { lastUpdated: 'desc' },
    });
    const mapped = rows.map((row) => {
      const raw = this.ensureObject(row.data);
      const start =
        this.extractString(raw, 'start_date_time') ||
        row.lastUpdated.toISOString();
      const end = this.extractString(raw, 'end_date_time');
      const startDate = new Date(start);
      const endDate = end ? new Date(end) : null;
      const durationMs =
        Number.isFinite(startDate.getTime()) &&
        endDate &&
        Number.isFinite(endDate.getTime())
          ? Math.max(0, endDate.getTime() - startDate.getTime())
          : 0;
      const hours = Math.floor(durationMs / 3600000);
      const minutes = Math.floor((durationMs % 3600000) / 60000);

      const totalCost = this.ensureObject(raw.total_cost);
      const amount =
        this.extractNumber(totalCost, 'incl_vat') ??
        this.extractNumber(totalCost, 'excl_vat') ??
        0;

      const mappedStatus = this.mapSessionStatus(
        this.extractString(raw, 'status') || '',
      );

      return {
        id: row.sessionId,
        role: this.mapSessionRole(this.extractString(raw, 'role')),
        partner: row.partyId,
        site:
          this.extractString(raw, 'location_id') ||
          this.extractString(raw, 'location_name') ||
          'Unknown',
        cp:
          this.extractString(raw, 'evse_uid') ||
          this.extractString(raw, 'connector_id') ||
          'N/A',
        start,
        end,
        dur: `${hours}h ${minutes}m`,
        kwh: this.extractNumber(raw, 'kwh') || 0,
        cur:
          this.extractString(totalCost, 'currency') ||
          this.extractString(raw, 'currency') ||
          'USD',
        amt: amount,
        status: mappedStatus,
        raw,
      };
    });

    const filtered = mapped.filter((item) =>
      this.matchesRoamingFilters(item, query),
    );
    return this.paginate(filtered, query);
  }

  async getRoamingSessionById(id: string) {
    const row = await this.prisma.ocpiPartnerSession.findFirst({
      where: { sessionId: id },
      orderBy: { lastUpdated: 'desc' },
    });
    return row ? row.data : null;
  }

  async getRoamingCdrs(query: OcpiRoamingListQueryDto): Promise<
    RoamingListResponse<{
      cdr: string;
      session: string;
      role: 'CPO' | 'MSP';
      partner: string;
      site: string;
      start: string;
      end: string | null;
      dur: string;
      kwh: number;
      cur: string;
      amt: number;
      tariff: string;
      fee: number;
      net: number;
      status: 'Finalized' | 'Sent' | 'Disputed' | 'Voided' | 'Pending';
      raw: Record<string, unknown>;
    }>
  > {
    const rows = await this.prisma.ocpiPartnerCdr.findMany({
      orderBy: { lastUpdated: 'desc' },
    });
    const mapped = rows.map((row) => {
      const raw = this.ensureObject(row.data);
      const start =
        this.extractString(raw, 'start_date_time') ||
        row.lastUpdated.toISOString();
      const end = this.extractString(raw, 'end_date_time');
      const startDate = new Date(start);
      const endDate = end ? new Date(end) : null;
      const durationMs =
        Number.isFinite(startDate.getTime()) &&
        endDate &&
        Number.isFinite(endDate.getTime())
          ? Math.max(0, endDate.getTime() - startDate.getTime())
          : 0;
      const hours = Math.floor(durationMs / 3600000);
      const minutes = Math.floor((durationMs % 3600000) / 60000);

      const totalCost = this.ensureObject(raw.total_cost);
      const amount =
        this.extractNumber(totalCost, 'incl_vat') ??
        this.extractNumber(totalCost, 'excl_vat') ??
        0;
      const fee = this.extractNumber(raw, 'commission_fee') || 0;

      return {
        cdr: row.cdrId,
        session:
          this.extractString(raw, 'session_id') ||
          this.extractString(raw, 'session') ||
          'N/A',
        role: this.mapSessionRole(this.extractString(raw, 'role')),
        partner: row.partyId,
        site:
          this.extractString(raw, 'location_id') ||
          this.extractString(raw, 'location_name') ||
          'Unknown',
        start,
        end,
        dur: `${hours}h ${minutes}m`,
        kwh:
          this.extractNumber(raw, 'total_energy') ||
          this.extractNumber(raw, 'kwh') ||
          0,
        cur:
          this.extractString(totalCost, 'currency') ||
          this.extractString(raw, 'currency') ||
          'USD',
        amt: amount,
        tariff: this.extractString(raw, 'tariff_id') || 'N/A',
        fee,
        net: Math.max(0, amount - fee),
        status: this.mapCdrStatus(this.extractString(raw, 'status') || ''),
        raw,
      };
    });

    const filtered = mapped.filter((item) =>
      this.matchesRoamingFilters(item, query),
    );
    return this.paginate(filtered, query);
  }

  async getRoamingCdrById(id: string) {
    const row = await this.prisma.ocpiPartnerCdr.findFirst({
      where: { cdrId: id },
      orderBy: { lastUpdated: 'desc' },
    });
    return row ? row.data : null;
  }

  async getChargePointRoamingPublication(chargePointId: string) {
    const cp = await this.prisma.chargePoint.findUnique({
      where: { id: chargePointId },
      select: {
        id: true,
        ocppId: true,
        stationId: true,
      },
    });
    if (!cp) {
      throw new NotFoundException('Charge point not found');
    }

    const record = await this.prisma.ocpiPartnerLocation.findFirst({
      where: {
        countryCode: this.defaultCountryCode(),
        partyId: this.defaultPartyId(),
        locationId: chargePointId,
      },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      chargePointId: cp.id,
      ocppId: cp.ocppId,
      stationId: cp.stationId,
      published: Boolean(record),
      updatedAt: record?.updatedAt?.toISOString() || null,
      lastUpdatedAt: record?.updatedAt?.toISOString() || null,
    };
  }

  async setChargePointRoamingPublication(
    chargePointId: string,
    published: boolean,
  ) {
    const cp = await this.prisma.chargePoint.findUnique({
      where: { id: chargePointId },
      include: {
        station: {
          include: { site: true },
        },
      },
    });
    if (!cp) {
      throw new NotFoundException('Charge point not found');
    }

    const countryCode = this.defaultCountryCode();
    const partyId = this.defaultPartyId();

    if (!published) {
      await this.prisma.ocpiPartnerLocation.deleteMany({
        where: {
          countryCode,
          partyId,
          locationId: chargePointId,
        },
      });
      return {
        chargePointId,
        published: false,
        updatedAt: new Date().toISOString(),
      };
    }

    const now = new Date();
    const locationData = this.buildPublishedLocationDocument(
      cp,
      countryCode,
      partyId,
      now,
    );
    const existing = await this.prisma.ocpiPartnerLocation.findFirst({
      where: {
        countryCode,
        partyId,
        locationId: chargePointId,
        version: '2.2.1',
      },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.ocpiPartnerLocation.update({
        where: { id: existing.id },
        data: {
          data: locationData as Prisma.InputJsonValue,
          lastUpdated: now,
        },
      });
    } else {
      await this.prisma.ocpiPartnerLocation.create({
        data: {
          countryCode,
          partyId,
          locationId: chargePointId,
          version: '2.2.1',
          data: locationData as Prisma.InputJsonValue,
          lastUpdated: now,
        },
      });
    }

    return {
      chargePointId,
      published: true,
      updatedAt: now.toISOString(),
    };
  }

  private mapPartnerStatus(
    status: string | null,
  ): 'Connected' | 'Pending' | 'Error' {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'ACTIVE') return 'Connected';
    if (normalized === 'PENDING') return 'Pending';
    return 'Error';
  }

  private extractPartnerModules(
    endpoints: Record<string, unknown>[],
  ): string[] {
    const moduleMap: Record<string, string> = {
      locations: 'Locations',
      sessions: 'Sessions',
      cdrs: 'CDRs',
      tariffs: 'Tariffs',
      tokens: 'Tokens',
      commands: 'Commands',
    };
    const modules = endpoints
      .map((endpoint) => this.extractString(endpoint, 'identifier'))
      .filter((identifier): identifier is string => Boolean(identifier))
      .map((identifier) => moduleMap[identifier.toLowerCase()])
      .filter((identifier): identifier is string => Boolean(identifier));

    if (modules.length === 0) {
      return ['Locations', 'Sessions', 'CDRs', 'Tariffs'];
    }

    return Array.from(new Set(modules));
  }

  private mapSessionRole(value: string | null): 'CPO' | 'MSP' {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'EMSP' || normalized === 'MSP') return 'MSP';
    return 'CPO';
  }

  private mapSessionStatus(
    value: string,
  ): 'Completed' | 'Charging' | 'Failed' | 'Refunded' {
    const normalized = value.toUpperCase();
    if (normalized === 'ACTIVE') return 'Charging';
    if (normalized === 'INVALID') return 'Failed';
    if (normalized === 'REFUNDED') return 'Refunded';
    return 'Completed';
  }

  private mapCdrStatus(
    value: string,
  ): 'Finalized' | 'Sent' | 'Disputed' | 'Voided' | 'Pending' {
    const normalized = value.toUpperCase();
    if (normalized === 'SENT') return 'Sent';
    if (normalized === 'DISPUTED') return 'Disputed';
    if (normalized === 'VOIDED') return 'Voided';
    if (normalized === 'PENDING') return 'Pending';
    return 'Finalized';
  }

  private matchesRoamingFilters<T extends Record<string, unknown>>(
    row: T,
    query: OcpiRoamingListQueryDto,
  ): boolean {
    const q = (query.q || '').trim().toLowerCase();
    if (q) {
      const joined = Object.values(row)
        .filter((value) => ['string', 'number'].includes(typeof value))
        .map((value) => String(value).toLowerCase())
        .join(' ');
      if (!joined.includes(q)) return false;
    }

    const partner = this.toUpperComparableString(row.partner);
    if (query.partner && partner !== query.partner.toUpperCase()) {
      return false;
    }
    const role = this.toUpperComparableString(row.role);
    if (query.role && role !== query.role.toUpperCase()) {
      return false;
    }
    const status = this.toUpperComparableString(row.status);
    if (query.status && status !== query.status.toUpperCase()) {
      return false;
    }

    if (query.from) {
      const start = this.parseRowDate(row.start);
      const from = new Date(query.from);
      if (start && Number.isFinite(from.getTime()) && start < from) {
        return false;
      }
    }

    if (query.to) {
      const start = this.parseRowDate(row.start);
      const to = new Date(query.to);
      if (start && Number.isFinite(to.getTime()) && start > to) {
        return false;
      }
    }

    return true;
  }

  private toUpperComparableString(value: unknown): string {
    if (typeof value === 'string') {
      return value.toUpperCase();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).toUpperCase();
    }
    return '';
  }

  private parseRowDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
    return null;
  }

  private paginate<T>(
    rows: T[],
    query: OcpiRoamingListQueryDto,
  ): RoamingListResponse<T> {
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    const total = rows.length;
    const items = rows.slice(offset, offset + limit);

    return { items, total, limit, offset };
  }

  private buildPublishedLocationDocument(
    cp: ChargePoint & {
      station: {
        id: string;
        name: string;
        address: string;
        latitude: number;
        longitude: number;
      } | null;
    },
    countryCode: string,
    partyId: string,
    now: Date,
  ): Record<string, unknown> {
    const station = cp.station;
    return {
      id: cp.id,
      country_code: countryCode,
      party_id: partyId,
      publish: true,
      name: station?.name || cp.ocppId,
      address: station?.address || 'Unknown address',
      city: 'Kampala',
      coordinates: {
        latitude: station?.latitude || 0,
        longitude: station?.longitude || 0,
      },
      evses: [
        {
          uid: cp.ocppId,
          status: String(cp.status || 'UNKNOWN').toUpperCase(),
          connectors: [
            {
              id: '1',
              standard: String(cp.type || 'IEC_62196_T2').toUpperCase(),
              format: 'SOCKET',
              power_type: 'AC_3_PHASE',
              max_voltage: 400,
              max_amperage: 32,
              max_electric_power: Math.round((cp.power || 50) * 1000),
              tariff_ids: [],
              last_updated: now.toISOString(),
            },
          ],
          last_updated: now.toISOString(),
        },
      ],
      last_updated: now.toISOString(),
    };
  }

  private defaultCountryCode(): string {
    return (this.config.get<string>('OCPI_COUNTRY_CODE') || 'US')
      .trim()
      .toUpperCase();
  }

  private defaultPartyId(): string {
    return (this.config.get<string>('OCPI_PARTY_ID') || 'EVZ')
      .trim()
      .toUpperCase();
  }

  private ensureObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private ensureArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item) => item && typeof item === 'object' && !Array.isArray(item),
      )
      .map((item) => item as Record<string, unknown>);
  }

  private extractString(
    source: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = source[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private extractNumber(
    source: Record<string, unknown>,
    key: string,
  ): number | null {
    const value = source[key];
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }
}
