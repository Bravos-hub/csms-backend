import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '@app/db';
import {
  EnergyLoadGroup,
  EnergyOptimizationPlan,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';

type PlanQuery = {
  stationId?: string;
  groupId?: string;
  state?: string;
};

type PlanInput = Record<string, unknown>;

type TariffBand = {
  id: string;
  label: string;
  startHour: number;
  endHour: number;
  daysOfWeek: number[];
  pricePerKwh: number;
};

type ScheduleEntry = {
  startAt: string;
  endAt: string;
  action: 'CHARGE' | 'IDLE';
  targetAmps: number;
  projectedEnergyKwh: number;
  projectedCost: number;
  pricePerKwh: number | null;
  tariffBandId: string | null;
  tariffBandLabel: string | null;
  reason: string;
};

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

@Injectable()
export class EnergyOptimizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listPlans(query: PlanQuery = {}) {
    const tenantId = this.resolveTenantId();
    const where: Prisma.EnergyOptimizationPlanWhereInput = { tenantId };
    if (query.stationId?.trim()) where.stationId = query.stationId.trim();
    if (query.groupId?.trim()) where.groupId = query.groupId.trim();
    if (query.state?.trim()) where.state = query.state.trim().toUpperCase();

    const rows = await this.prisma.energyOptimizationPlan.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((row) => this.toResponse(row));
  }

  async getPlan(id: string) {
    const tenantId = this.resolveTenantId();
    const row = await this.prisma.energyOptimizationPlan.findUnique({
      where: { id },
    });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException('Optimization plan not found');
    }
    return this.toResponse(row);
  }

  async createPlan(input: PlanInput, actorId?: string) {
    const tenantId = this.resolveTenantId();
    const stationId = this.readString(input.stationId);
    if (!stationId) {
      throw new BadRequestException('stationId is required');
    }

    const station = await this.loadStationOrThrow(stationId, tenantId);
    const group = await this.resolveGroup(
      tenantId,
      station.id,
      this.readOptionalString(input.groupId),
    );
    const derProfile = await this.prisma.energyDerProfile.findUnique({
      where: {
        tenantId_stationId: {
          tenantId,
          stationId: station.id,
        },
      },
      select: {
        status: true,
        maxGridImportKw: true,
        reserveGridKw: true,
        solarEnabled: true,
        maxSolarContributionKw: true,
        bessEnabled: true,
        maxBessDischargeKw: true,
        bessSocPercent: true,
        bessReserveSocPercent: true,
      },
    });
    const derConstraint = this.computeDerConstraint(derProfile);

    const windowStart = this.readDate(input.windowStart) || new Date();
    const requestedEnd = this.readDate(input.windowEnd);
    const departureTime = this.readDate(input.departureTime);
    const defaultWindowEnd = new Date(windowStart.getTime() + 8 * 3600 * 1000);
    const windowEnd = requestedEnd || departureTime || defaultWindowEnd;
    if (windowEnd.getTime() <= windowStart.getTime()) {
      throw new BadRequestException('windowEnd must be after windowStart');
    }

    const targetEnergyKwh =
      this.readNonNegativeNumber(input.targetEnergyKwh) ?? 60;
    const dryRun = this.readBoolean(input.dryRun) ?? true;
    const maxChargeAmpsInput =
      this.readPositiveInt(input.maxChargeAmps) ??
      this.readPositiveInt(input.maxAmps) ??
      32;
    const minChargeAmpsInput =
      this.readNonNegativeInt(input.minChargeAmps) ??
      this.readNonNegativeInt(input.minAmps) ??
      0;

    const capacityFromGroup = group
      ? this.minPositive([
          group.siteLimitAmpsPhase1,
          group.siteLimitAmpsPhase2,
          group.siteLimitAmpsPhase3,
        ])
      : null;
    const derMaxAmps =
      derConstraint.effectiveMaxChargingAmps &&
      derConstraint.effectiveMaxChargingAmps > 0
        ? derConstraint.effectiveMaxChargingAmps
        : null;
    const maxChargeAmps = Math.max(
      1,
      this.minPositive([maxChargeAmpsInput, capacityFromGroup, derMaxAmps]) ??
        maxChargeAmpsInput,
    );
    const minChargeAmps = Math.max(
      0,
      Math.min(minChargeAmpsInput, maxChargeAmps),
    );

    const explicitTariffCalendarId = this.readOptionalString(
      input.tariffCalendarId,
    );
    const tariff = await this.resolveTariffCalendar({
      tenantId,
      stationSiteId: station.siteId,
      calendarId: explicitTariffCalendarId || undefined,
      at: windowStart,
    });

    const fallbackReason = this.evaluateFallbackReason(tariff, windowStart);
    const bands = tariff ? this.parseTariffBands(tariff.bands) : [];
    const hasConsistentBands =
      tariff && this.evaluateBandConsistency(bands).isConsistent;
    const shouldFallback =
      Boolean(fallbackReason) ||
      Boolean(derConstraint.fallbackReason) ||
      !hasConsistentBands;

    let schedule: ScheduleEntry[] = [];
    let summary: Record<string, unknown> = {};
    let diagnostics: Record<string, unknown> = {};

    if (!shouldFallback) {
      const generated = this.generateSchedule({
        windowStart,
        windowEnd,
        timezone: tariff?.timezone || 'UTC',
        bands,
        maxChargeAmps,
        minChargeAmps,
        targetEnergyKwh,
      });
      schedule = generated.entries;
      summary = generated.summary;
      diagnostics = generated.diagnostics;
    } else {
      summary = {
        mode: 'DLM_FALLBACK',
        explanation:
          fallbackReason ||
          derConstraint.fallbackReason ||
          'Tariff bands are inconsistent; scheduler deferred to Phase 1 DLM.',
      };
      diagnostics = {
        fallback: true,
        reason:
          fallbackReason ||
          derConstraint.fallbackReason ||
          'INCONSISTENT_TARIFF_BANDS',
      };
    }

    const state = shouldFallback
      ? 'FALLBACK_DLM'
      : dryRun
        ? 'DRAFT'
        : 'READY_FOR_APPROVAL';

    const created = await this.prisma.energyOptimizationPlan.create({
      data: {
        tenantId,
        stationId: station.id,
        groupId: group?.id || null,
        tariffCalendarId: tariff?.id || explicitTariffCalendarId || null,
        state,
        fallbackReason: shouldFallback
          ? fallbackReason ||
            derConstraint.fallbackReason ||
            'INCONSISTENT_TARIFF_BANDS'
          : null,
        windowStart,
        windowEnd,
        constraints: {
          targetEnergyKwh,
          minChargeAmps,
          maxChargeAmps,
          requestedWindowHours: Number(
            ((windowEnd.getTime() - windowStart.getTime()) / 3600000).toFixed(
              2,
            ),
          ),
          departureTime: departureTime?.toISOString() || null,
          derConstraint,
        } as unknown as Prisma.InputJsonValue,
        summary: summary as Prisma.InputJsonValue,
        schedule:
          schedule.length > 0
            ? (schedule as unknown as Prisma.InputJsonValue)
            : undefined,
        diagnostics: {
          ...diagnostics,
          derConstraint,
          tariffStatus: tariff?.status || 'MISSING',
          tariffCalendarId: tariff?.id || null,
          tariffVersion: tariff?.version || null,
          tariffSiteId: tariff?.siteId || null,
        } as Prisma.InputJsonValue,
        createdBy: actorId || null,
      },
    });

    return this.getPlan(created.id);
  }

  async approvePlan(id: string, actorId?: string) {
    const tenantId = this.resolveTenantId();
    const row = await this.prisma.energyOptimizationPlan.findUnique({
      where: { id },
    });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException('Optimization plan not found');
    }

    if (row.state === 'FALLBACK_DLM') {
      throw new BadRequestException(
        'Fallback plans cannot be approved. Keep EMS in DLM mode.',
      );
    }

    await this.prisma.energyOptimizationPlan.update({
      where: { id: row.id },
      data: {
        state: 'APPROVED',
        approvedBy: actorId || row.approvedBy,
        approvedAt: new Date(),
      },
    });

    return this.getPlan(row.id);
  }

  private async resolveTariffCalendar(input: {
    tenantId: string;
    stationSiteId: string | null;
    calendarId?: string;
    at: Date;
  }) {
    if (input.calendarId) {
      const explicit = await this.prisma.tariffCalendar.findUnique({
        where: { id: input.calendarId },
      });
      if (!explicit || explicit.tenantId !== input.tenantId) {
        throw new NotFoundException('Tariff calendar not found');
      }
      return explicit;
    }

    const where: Prisma.TariffCalendarWhereInput = {
      tenantId: input.tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: input.at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.at } }],
    };
    if (input.stationSiteId) {
      where.AND = [{ OR: [{ siteId: input.stationSiteId }, { siteId: null }] }];
    }

    const rows = await this.prisma.tariffCalendar.findMany({
      where,
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    });

    if (!rows.length) return null;

    const stationSiteId = input.stationSiteId || null;
    const sorted = [...rows].sort((left, right) => {
      const leftScore = left.siteId && left.siteId === stationSiteId ? 1 : 0;
      const rightScore = right.siteId && right.siteId === stationSiteId ? 1 : 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      if (left.version !== right.version) return right.version - left.version;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });

    return sorted[0] || null;
  }

  private evaluateFallbackReason(
    tariff: {
      status: string;
      effectiveTo: Date | null;
    } | null,
    at: Date,
  ) {
    if (!tariff) return 'NO_ACTIVE_TARIFF';
    if (tariff.status !== 'ACTIVE') return 'TARIFF_NOT_ACTIVE';
    if (tariff.effectiveTo && tariff.effectiveTo.getTime() < at.getTime()) {
      return 'STALE_TARIFF';
    }
    return null;
  }

  private computeDerConstraint(
    profile: {
      status: string;
      maxGridImportKw: number | null;
      reserveGridKw: number | null;
      solarEnabled: boolean;
      maxSolarContributionKw: number | null;
      bessEnabled: boolean;
      maxBessDischargeKw: number | null;
      bessSocPercent: number | null;
      bessReserveSocPercent: number | null;
    } | null,
  ) {
    if (!profile) {
      return {
        profileActive: false,
        profileStatus: null as string | null,
        gridHeadroomKw: null as number | null,
        solarContributionKw: 0,
        bessContributionKw: 0,
        bessDischargeAllowed: false,
        totalAvailableKw: null as number | null,
        effectiveMaxChargingAmps: null as number | null,
        fallbackReason: null as string | null,
      };
    }

    const profileActive = profile.status === 'ACTIVE';
    if (!profileActive) {
      return {
        profileActive: false,
        profileStatus: profile.status,
        gridHeadroomKw: null as number | null,
        solarContributionKw: 0,
        bessContributionKw: 0,
        bessDischargeAllowed: false,
        totalAvailableKw: null as number | null,
        effectiveMaxChargingAmps: null as number | null,
        fallbackReason: null as string | null,
      };
    }

    const gridHeadroomKw =
      profile.maxGridImportKw === null
        ? null
        : Math.max(0, profile.maxGridImportKw - (profile.reserveGridKw ?? 0));
    const solarContributionKw = profile.solarEnabled
      ? Math.max(0, profile.maxSolarContributionKw ?? 0)
      : 0;
    const bessDischargeAllowed =
      profile.bessEnabled &&
      (profile.bessSocPercent ?? 100) > (profile.bessReserveSocPercent ?? 0);
    const bessContributionKw = bessDischargeAllowed
      ? Math.max(0, profile.maxBessDischargeKw ?? 0)
      : 0;

    const totalAvailableKw =
      (gridHeadroomKw ?? 0) + solarContributionKw + bessContributionKw;
    const effectiveMaxChargingAmps = Math.max(
      0,
      Math.floor((totalAvailableKw * 1000) / (3 * 230)),
    );

    return {
      profileActive: true,
      profileStatus: profile.status,
      gridHeadroomKw,
      solarContributionKw,
      bessContributionKw,
      bessDischargeAllowed,
      totalAvailableKw: Number(totalAvailableKw.toFixed(4)),
      effectiveMaxChargingAmps,
      fallbackReason:
        effectiveMaxChargingAmps <= 0 ? 'DER_CONSTRAINT_ZERO_HEADROOM' : null,
    };
  }

  private parseTariffBands(value: Prisma.JsonValue): TariffBand[] {
    if (!Array.isArray(value)) return [];

    const bands: TariffBand[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const record = this.readObject(value[index]);
      if (!record) continue;

      const startHour = this.readNonNegativeInt(record.startHour);
      const endHour = this.readPositiveInt(record.endHour);
      const pricePerKwh = this.readNonNegativeNumber(
        record.pricePerKwh ?? record.price,
      );
      if (
        startHour === null ||
        endHour === null ||
        pricePerKwh === null ||
        endHour <= startHour
      ) {
        continue;
      }

      const daysOfWeek = this.normalizeDaysOfWeek(record.daysOfWeek);
      bands.push({
        id: this.readString(record.id) || `band-${index + 1}`,
        label: this.readString(record.label) || `Band ${index + 1}`,
        startHour,
        endHour,
        daysOfWeek,
        pricePerKwh,
      });
    }

    return bands;
  }

  private evaluateBandConsistency(bands: TariffBand[]) {
    const issues: string[] = [];
    if (!bands.length) {
      issues.push('No valid tariff bands were found');
      return { isConsistent: false, issues };
    }

    for (let day = 0; day < 7; day += 1) {
      const dayBands = bands
        .filter((band) => band.daysOfWeek.includes(day))
        .sort((left, right) => left.startHour - right.startHour);

      for (let index = 1; index < dayBands.length; index += 1) {
        const previous = dayBands[index - 1];
        const current = dayBands[index];
        if (previous.endHour > current.startHour) {
          issues.push(
            `Bands ${previous.label} and ${current.label} overlap on day ${day}`,
          );
        }
      }
    }

    return {
      isConsistent: issues.length === 0,
      issues,
    };
  }

  private generateSchedule(input: {
    windowStart: Date;
    windowEnd: Date;
    timezone: string;
    bands: TariffBand[];
    maxChargeAmps: number;
    minChargeAmps: number;
    targetEnergyKwh: number;
  }) {
    const slots = this.buildSlots(input.windowStart, input.windowEnd);
    const ampsToKw = (amps: number) =>
      Number(((amps * 3 * 230) / 1000).toFixed(4));
    const chargePowerKw = ampsToKw(input.maxChargeAmps);
    const fallbackPowerKw = ampsToKw(input.minChargeAmps);

    const pricedSlots = slots.map((slot, index) => {
      const { day, hour } = this.extractDayHour(slot.startAt, input.timezone);
      const band =
        input.bands.find(
          (entry) =>
            entry.daysOfWeek.includes(day) &&
            hour >= entry.startHour &&
            hour < entry.endHour,
        ) || null;
      const slotHours =
        (slot.endAt.getTime() - slot.startAt.getTime()) / 3600000;
      const energyKwh = Number((slotHours * chargePowerKw).toFixed(4));
      return {
        slotIndex: index,
        startAt: slot.startAt,
        endAt: slot.endAt,
        slotHours,
        energyKwh,
        band,
        pricePerKwh: band?.pricePerKwh ?? Number.POSITIVE_INFINITY,
      };
    });

    const sortedForCharge = [...pricedSlots].sort((left, right) => {
      if (left.pricePerKwh !== right.pricePerKwh) {
        return left.pricePerKwh - right.pricePerKwh;
      }
      return left.startAt.getTime() - right.startAt.getTime();
    });

    const chargeSlotSet = new Set<number>();
    let remainingEnergy = input.targetEnergyKwh;
    for (const slot of sortedForCharge) {
      if (remainingEnergy <= 0) break;
      chargeSlotSet.add(slot.slotIndex);
      remainingEnergy -= slot.energyKwh;
    }

    const entries: ScheduleEntry[] = pricedSlots.map((slot) => {
      const shouldCharge = chargeSlotSet.has(slot.slotIndex);
      const targetAmps = shouldCharge
        ? input.maxChargeAmps
        : input.minChargeAmps;
      const powerKw = shouldCharge ? chargePowerKw : fallbackPowerKw;
      const projectedEnergyKwh = Number((slot.slotHours * powerKw).toFixed(4));
      const pricePerKwh = Number.isFinite(slot.pricePerKwh)
        ? slot.pricePerKwh
        : null;
      const projectedCost =
        pricePerKwh === null
          ? 0
          : Number((projectedEnergyKwh * pricePerKwh).toFixed(4));

      return {
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        action: shouldCharge ? 'CHARGE' : 'IDLE',
        targetAmps,
        projectedEnergyKwh,
        projectedCost,
        pricePerKwh,
        tariffBandId: slot.band?.id || null,
        tariffBandLabel: slot.band?.label || null,
        reason: shouldCharge
          ? pricePerKwh === null
            ? 'No tariff band available; selected to satisfy energy target.'
            : 'Selected among lowest-cost tariff windows.'
          : 'Outside lowest-cost windows for this target energy.',
      };
    });

    const projectedEnergyKwh = Number(
      entries
        .reduce((sum, entry) => sum + entry.projectedEnergyKwh, 0)
        .toFixed(4),
    );
    const projectedCost = Number(
      entries.reduce((sum, entry) => sum + entry.projectedCost, 0).toFixed(4),
    );
    const chargeWindowCount = entries.filter(
      (entry) => entry.action === 'CHARGE',
    ).length;

    return {
      entries,
      summary: {
        targetEnergyKwh: input.targetEnergyKwh,
        projectedEnergyKwh,
        projectedCost,
        chargeWindowCount,
        totalWindowCount: entries.length,
        maxChargeAmps: input.maxChargeAmps,
        minChargeAmps: input.minChargeAmps,
      },
      diagnostics: {
        timezone: input.timezone,
        remainingEnergyKwh: Number(Math.max(0, remainingEnergy).toFixed(4)),
        hasMissingTariffSlots: entries.some(
          (entry) => entry.pricePerKwh === null,
        ),
      },
    };
  }

  private extractDayHour(date: Date, timezone: string) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const weekday =
      parts.find((part) => part.type === 'weekday')?.value || 'sun';
    const hourText = parts.find((part) => part.type === 'hour')?.value || '0';
    const day = DAY_INDEX[weekday.toLowerCase().slice(0, 3)] ?? 0;
    const hour = Number(hourText);
    return {
      day,
      hour: Number.isFinite(hour) ? hour : 0,
    };
  }

  private buildSlots(windowStart: Date, windowEnd: Date) {
    const slots: Array<{ startAt: Date; endAt: Date }> = [];
    let cursor = new Date(windowStart);
    while (cursor.getTime() < windowEnd.getTime()) {
      const next = new Date(
        Math.min(cursor.getTime() + 3600 * 1000, windowEnd.getTime()),
      );
      slots.push({ startAt: new Date(cursor), endAt: next });
      cursor = next;
    }
    return slots;
  }

  private async loadStationOrThrow(stationId: string, tenantId: string) {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: {
        id: true,
        siteId: true,
        orgId: true,
        site: {
          select: {
            organizationId: true,
          },
        },
      },
    });
    if (!station) {
      throw new NotFoundException('Station not found');
    }

    const stationTenant = station.orgId || station.site?.organizationId || null;
    if (stationTenant && stationTenant !== tenantId) {
      throw new NotFoundException('Station not found');
    }
    return station;
  }

  private async resolveGroup(
    tenantId: string,
    stationId: string,
    requestedGroupId?: string,
  ): Promise<EnergyLoadGroup | null> {
    if (requestedGroupId) {
      const group = await this.prisma.energyLoadGroup.findUnique({
        where: { id: requestedGroupId },
      });
      if (
        !group ||
        group.tenantId !== tenantId ||
        group.stationId !== stationId
      ) {
        throw new NotFoundException('Energy load group not found');
      }
      return group;
    }

    return this.prisma.energyLoadGroup.findFirst({
      where: {
        tenantId,
        stationId,
        isActive: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  private toResponse(row: EnergyOptimizationPlan) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      stationId: row.stationId,
      groupId: row.groupId,
      tariffCalendarId: row.tariffCalendarId,
      state: row.state,
      fallbackReason: row.fallbackReason,
      windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(),
      constraints: row.constraints,
      summary: row.summary,
      schedule: row.schedule,
      diagnostics: row.diagnostics,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private normalizeDaysOfWeek(value: unknown) {
    if (!Array.isArray(value)) {
      return [0, 1, 2, 3, 4, 5, 6];
    }
    const days = value
      .map((entry) => {
        if (typeof entry === 'number' && Number.isInteger(entry)) return entry;
        if (typeof entry === 'string') {
          const asNumber = Number(entry);
          if (Number.isInteger(asNumber)) return asNumber;
          const key = entry.trim().toLowerCase().slice(0, 3);
          return key in DAY_INDEX ? DAY_INDEX[key] : -1;
        }
        return -1;
      })
      .filter((entry) => entry >= 0 && entry <= 6);

    return days.length
      ? Array.from(new Set(days)).sort((left, right) => left - right)
      : [0, 1, 2, 3, 4, 5, 6];
  }

  private minPositive(values: Array<number | null | undefined>) {
    const positives = values.filter(
      (value): value is number => typeof value === 'number' && value > 0,
    );
    if (!positives.length) return null;
    return Math.min(...positives);
  }

  private readObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
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

  private readDate(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  private readBoolean(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return undefined;
  }

  private readPositiveInt(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.floor(parsed);
    return normalized > 0 ? normalized : null;
  }

  private readNonNegativeInt(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.floor(parsed);
    return normalized >= 0 ? normalized : null;
  }

  private readNonNegativeNumber(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Number(parsed.toFixed(4));
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
