import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { Prisma, TariffCalendar } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

type TariffListQuery = {
  siteId?: string;
  status?: string;
};

type TariffPayload = Record<string, unknown>;
type TariffBandRecord = {
  id: string;
  label: string;
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
  pricePerKwh: number;
  currency: string;
};

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

@Injectable()
export class TariffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listCalendars(query: TariffListQuery = {}) {
    const tenantId = this.resolveTenantId();
    const where: Prisma.TariffCalendarWhereInput = { tenantId };
    if (query.siteId?.trim()) where.siteId = query.siteId.trim();
    const normalizedStatus = this.normalizeStatus(query.status);
    if (normalizedStatus) {
      where.status = normalizedStatus;
    } else {
      where.status = { not: 'ARCHIVED' };
    }

    const rows = await this.prisma.tariffCalendar.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { effectiveFrom: 'desc' },
        { version: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    return rows.map((row) => this.toResponse(row));
  }

  async getCalendar(id: string) {
    const tenantId = this.resolveTenantId();
    const row = await this.prisma.tariffCalendar.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException('Tariff calendar not found');
    }
    return this.toResponse(row);
  }

  async createCalendar(input: TariffPayload, actorId?: string) {
    const tenantId = this.resolveTenantId();
    const siteId = this.readOptionalString(input.siteId);
    if (siteId) {
      await this.assertSiteBelongsToTenant(siteId, tenantId);
    }

    const name = this.readString(input.name);
    if (!name) throw new BadRequestException('name is required');

    const currency = this.normalizeCurrency(input.currency);
    const timezone = this.readString(input.timezone) || 'UTC';
    const effectiveFrom = this.readDate(input.effectiveFrom) || new Date();
    const effectiveTo = this.readDate(input.effectiveTo);
    if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }

    const bands = this.normalizeBands(input.bands, currency, input.pricePerKwh);
    const requestedVersion = this.readPositiveInt(input.version);
    const version =
      requestedVersion ??
      (await this.nextVersion({
        tenantId,
        siteId,
        name,
      }));
    const status = this.normalizeStatus(input.status) || 'DRAFT';

    const created = await this.prisma.tariffCalendar.create({
      data: {
        tenantId,
        siteId: siteId || null,
        name,
        version,
        currency,
        timezone,
        status,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        bands: bands as unknown as Prisma.InputJsonValue,
        metadata: this.readObject(input.metadata)
          ? (this.readObject(input.metadata) as Prisma.InputJsonValue)
          : undefined,
        createdBy: actorId || null,
        approvedBy: status === 'ACTIVE' ? actorId || null : null,
        approvedAt: status === 'ACTIVE' ? new Date() : null,
      },
    });

    if (status === 'ACTIVE') {
      await this.ensureSingleActiveCalendar(created);
    }

    return this.getCalendar(created.id);
  }

  async updateCalendar(id: string, input: TariffPayload, actorId?: string) {
    const tenantId = this.resolveTenantId();
    const current = await this.loadCalendarOrThrow(id, tenantId);
    const data: Prisma.TariffCalendarUpdateInput = {};

    if (input.siteId !== undefined) {
      const siteId = this.readOptionalString(input.siteId);
      if (siteId) {
        await this.assertSiteBelongsToTenant(siteId, tenantId);
      }
      data.siteId = siteId || null;
    }

    if (input.name !== undefined) {
      const name = this.readString(input.name);
      if (!name) throw new BadRequestException('name cannot be empty');
      data.name = name;
    }

    if (input.version !== undefined) {
      const version = this.readPositiveInt(input.version);
      if (!version) throw new BadRequestException('version must be positive');
      data.version = version;
    }

    if (input.currency !== undefined) {
      data.currency = this.normalizeCurrency(input.currency);
    }

    if (input.timezone !== undefined) {
      const timezone = this.readString(input.timezone);
      if (!timezone) throw new BadRequestException('timezone cannot be empty');
      data.timezone = timezone;
    }

    if (input.effectiveFrom !== undefined) {
      const value = this.readDate(input.effectiveFrom);
      if (!value) {
        throw new BadRequestException('effectiveFrom is invalid');
      }
      data.effectiveFrom = value;
    }

    if (input.effectiveTo !== undefined) {
      const value = this.readDate(input.effectiveTo);
      if (input.effectiveTo !== null && !value) {
        throw new BadRequestException('effectiveTo is invalid');
      }
      data.effectiveTo = value || null;
    }

    if (input.metadata !== undefined) {
      const metadata = this.readObject(input.metadata);
      data.metadata = metadata as Prisma.InputJsonValue;
    }

    if (input.bands !== undefined || input.pricePerKwh !== undefined) {
      const currency = this.readString(input.currency) || current.currency;
      const bands = this.normalizeBands(
        input.bands,
        currency,
        input.pricePerKwh,
      );
      data.bands = bands as unknown as Prisma.InputJsonValue;
    }

    const requestedStatus = this.normalizeStatus(input.status);
    if (requestedStatus) {
      data.status = requestedStatus;
    }

    const nextEffectiveFrom =
      (data.effectiveFrom as Date | undefined) || current.effectiveFrom;
    const nextEffectiveTo =
      data.effectiveTo === undefined
        ? current.effectiveTo
        : ((data.effectiveTo as Date | null) ?? null);
    if (
      nextEffectiveTo &&
      nextEffectiveTo.getTime() <= nextEffectiveFrom.getTime()
    ) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }

    const updated = await this.prisma.tariffCalendar.update({
      where: { id: current.id },
      data: {
        ...data,
        approvedBy:
          requestedStatus === 'ACTIVE'
            ? actorId || current.approvedBy
            : data.approvedBy,
        approvedAt:
          requestedStatus === 'ACTIVE' ? new Date() : (data.approvedAt as Date),
      },
    });

    if ((requestedStatus || current.status) === 'ACTIVE') {
      await this.ensureSingleActiveCalendar(updated);
    }

    return this.getCalendar(updated.id);
  }

  async activateCalendar(id: string, actorId?: string) {
    const tenantId = this.resolveTenantId();
    const current = await this.loadCalendarOrThrow(id, tenantId);
    const active = await this.prisma.tariffCalendar.update({
      where: { id: current.id },
      data: {
        status: 'ACTIVE',
        approvedBy: actorId || current.approvedBy,
        approvedAt: new Date(),
      },
    });

    await this.ensureSingleActiveCalendar(active);
    return this.getCalendar(active.id);
  }

  async archiveCalendar(id: string, actorId?: string) {
    void actorId;
    const tenantId = this.resolveTenantId();
    const current = await this.loadCalendarOrThrow(id, tenantId);
    await this.prisma.tariffCalendar.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED' },
    });
    return this.getCalendar(current.id);
  }

  async resolveEffectiveCalendarForStation(
    stationId: string,
    at: Date = new Date(),
  ) {
    const tenantId = this.resolveTenantId();
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: {
        id: true,
        siteId: true,
        orgId: true,
        site: { select: { organizationId: true } },
      },
    });

    if (!station) {
      throw new NotFoundException('Station not found');
    }

    const stationTenantId =
      station.orgId || station.site?.organizationId || null;
    if (stationTenantId && stationTenantId !== tenantId) {
      throw new NotFoundException('Station not found');
    }

    const where: Prisma.TariffCalendarWhereInput = {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
    };
    if (station.siteId) {
      where.AND = [{ OR: [{ siteId: station.siteId }, { siteId: null }] }];
    }

    const rows = await this.prisma.tariffCalendar.findMany({
      where,
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    });

    const sorted = [...rows].sort((left, right) => {
      const leftSiteScore =
        left.siteId && left.siteId === station.siteId ? 1 : 0;
      const rightSiteScore =
        right.siteId && right.siteId === station.siteId ? 1 : 0;
      if (leftSiteScore !== rightSiteScore) {
        return rightSiteScore - leftSiteScore;
      }
      if (left.version !== right.version) {
        return right.version - left.version;
      }
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });

    const resolved = sorted[0];
    return resolved ? this.toResponse(resolved) : null;
  }

  private async loadCalendarOrThrow(id: string, tenantId: string) {
    const row = await this.prisma.tariffCalendar.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException('Tariff calendar not found');
    }
    return row;
  }

  private async assertSiteBelongsToTenant(siteId: string, tenantId: string) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, organizationId: true },
    });
    if (!site) {
      throw new NotFoundException('Site not found');
    }
    if (site.organizationId && site.organizationId !== tenantId) {
      throw new NotFoundException('Site not found');
    }
  }

  private async nextVersion(input: {
    tenantId: string;
    siteId?: string;
    name: string;
  }) {
    const latest = await this.prisma.tariffCalendar.findFirst({
      where: {
        tenantId: input.tenantId,
        siteId: input.siteId || null,
        name: input.name,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version || 0) + 1;
  }

  private async ensureSingleActiveCalendar(active: TariffCalendar) {
    await this.prisma.tariffCalendar.updateMany({
      where: {
        tenantId: active.tenantId,
        id: { not: active.id },
        siteId: active.siteId,
        status: 'ACTIVE',
      },
      data: { status: 'DRAFT' },
    });
  }

  private toResponse(row: TariffCalendar) {
    const now = Date.now();
    const bands = this.coerceStoredBands(row.bands, row.currency);
    const integrity = this.evaluateBandIntegrity(bands);
    const stale = row.effectiveTo ? row.effectiveTo.getTime() < now : false;
    const floorPrice = bands.reduce(
      (min, band) => Math.min(min, band.pricePerKwh),
      Number.POSITIVE_INFINITY,
    );
    const averagePrice =
      bands.length > 0
        ? Number(
            (
              bands.reduce((sum, band) => sum + band.pricePerKwh, 0) /
              bands.length
            ).toFixed(4),
          )
        : 0;

    return {
      id: row.id,
      tenantId: row.tenantId,
      siteId: row.siteId,
      name: row.name,
      version: row.version,
      currency: row.currency,
      timezone: row.timezone,
      status: row.status,
      active: row.status === 'ACTIVE',
      type: 'Time',
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
      pricePerKwh:
        floorPrice === Number.POSITIVE_INFINITY
          ? 0
          : Number(floorPrice.toFixed(4)),
      averagePricePerKwh: averagePrice,
      bandCount: bands.length,
      bands,
      stale,
      inconsistent: !integrity.isConsistent,
      integrity,
      metadata: this.readObject(row.metadata),
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private normalizeBands(
    value: unknown,
    currency: string,
    legacyPriceValue?: unknown,
  ): TariffBandRecord[] {
    const bands = Array.isArray(value) ? value : null;
    const normalized: TariffBandRecord[] = [];

    if (bands) {
      for (let index = 0; index < bands.length; index += 1) {
        const record = this.readObject(bands[index]);
        if (!record) {
          throw new BadRequestException('Each tariff band must be an object');
        }
        const startHour = this.readHour(record.startHour, 0, 'startHour');
        const endHour = this.readHour(record.endHour, 24, 'endHour');
        if (startHour === null || endHour === null) {
          throw new BadRequestException('startHour and endHour are required');
        }
        if (endHour <= startHour) {
          throw new BadRequestException(
            'endHour must be greater than startHour',
          );
        }
        const pricePerKwh = this.readPrice(
          record.pricePerKwh ?? record.price,
          'pricePerKwh',
        );
        if (pricePerKwh === null) {
          throw new BadRequestException('pricePerKwh is required');
        }
        const daysOfWeek = this.normalizeDaysOfWeek(record.daysOfWeek);
        const bandCurrency = this.normalizeCurrency(
          record.currency || currency,
        );

        normalized.push({
          id: this.readString(record.id) || `band-${index + 1}`,
          label: this.readString(record.label) || `Band ${index + 1}`,
          daysOfWeek,
          startHour,
          endHour,
          pricePerKwh,
          currency: bandCurrency,
        });
      }
    } else if (legacyPriceValue !== undefined) {
      const price = this.readPrice(legacyPriceValue, 'pricePerKwh');
      if (price === null) {
        throw new BadRequestException('pricePerKwh is required');
      }
      normalized.push({
        id: 'band-1',
        label: 'Flat rate',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startHour: 0,
        endHour: 24,
        pricePerKwh: price,
        currency,
      });
    }

    if (!normalized.length) {
      throw new BadRequestException(
        'At least one tariff band or pricePerKwh is required',
      );
    }

    return normalized;
  }

  private coerceStoredBands(value: Prisma.JsonValue, currency: string) {
    if (!Array.isArray(value)) {
      return [];
    }

    const normalized: TariffBandRecord[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const record = this.readObject(value[index]);
      if (!record) continue;
      const startHour = this.readHour(record.startHour, 0);
      const endHour = this.readHour(record.endHour, 24);
      const pricePerKwh = this.readPrice(record.pricePerKwh ?? record.price);
      if (startHour === null || endHour === null || pricePerKwh === null) {
        continue;
      }
      normalized.push({
        id: this.readString(record.id) || `band-${index + 1}`,
        label: this.readString(record.label) || `Band ${index + 1}`,
        daysOfWeek: this.normalizeDaysOfWeek(record.daysOfWeek),
        startHour,
        endHour,
        pricePerKwh,
        currency: this.normalizeCurrency(record.currency || currency),
      });
    }

    return normalized;
  }

  private evaluateBandIntegrity(bands: TariffBandRecord[]) {
    const issues: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      const dayBands = bands
        .filter((band) => band.daysOfWeek.includes(day))
        .sort((left, right) => left.startHour - right.startHour);

      for (let index = 0; index < dayBands.length; index += 1) {
        const current = dayBands[index];
        if (current.startHour < 0 || current.endHour > 24) {
          issues.push(
            `Band ${current.label} has out-of-range hours for ${DAY_NAMES[day]}`,
          );
        }

        if (index > 0) {
          const previous = dayBands[index - 1];
          if (previous.endHour > current.startHour) {
            issues.push(
              `Bands overlap on ${DAY_NAMES[day]} between ${previous.label} and ${current.label}`,
            );
          }
        }
      }
    }

    return {
      isConsistent: issues.length === 0,
      issues,
    };
  }

  private normalizeDaysOfWeek(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [0, 1, 2, 3, 4, 5, 6];
    }

    const days = value
      .map((entry) => {
        if (typeof entry === 'number' && Number.isInteger(entry)) {
          return entry;
        }
        if (typeof entry === 'string') {
          const asNumber = Number(entry);
          if (Number.isInteger(asNumber)) {
            return asNumber;
          }
          const index = DAY_NAMES.indexOf(
            entry.trim().slice(0, 3).toLowerCase(),
          );
          return index >= 0 ? index : -1;
        }
        return -1;
      })
      .filter((entry) => entry >= 0 && entry <= 6);

    if (!days.length) {
      return [0, 1, 2, 3, 4, 5, 6];
    }

    return Array.from(new Set(days)).sort((left, right) => left - right);
  }

  private normalizeStatus(value: unknown) {
    const normalized = this.readString(value)?.toUpperCase();
    if (!normalized) return null;
    if (['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(normalized)) {
      return normalized;
    }
    return null;
  }

  private normalizeCurrency(value: unknown) {
    const currency = this.readString(value)?.toUpperCase() || 'USD';
    if (currency.length < 3 || currency.length > 4) {
      throw new BadRequestException('currency must be a valid code');
    }
    return currency;
  }

  private readHour(
    value: unknown,
    fallback: number | null = null,
    fieldName = 'hour',
  ) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) {
      throw new BadRequestException(`${fieldName} must be between 0 and 24`);
    }
    return Math.floor(parsed);
  }

  private readPrice(value: unknown, fieldName = 'price') {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException(
        `${fieldName} must be a non-negative number`,
      );
    }
    return Number(parsed.toFixed(4));
  }

  private readPositiveInt(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.floor(parsed);
    return normalized > 0 ? normalized : null;
  }

  private readDate(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  private readObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readOptionalString(value: unknown): string | undefined {
    return this.readString(value);
  }

  private resolveTenantId() {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId ||
      context?.authenticatedOrganizationId ||
      null;
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }
    return tenantId;
  }
}
