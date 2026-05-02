import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TelemetryProviderType, UserRole } from '@prisma/client';
import { TenantContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';
import { CommandsService } from '../commands/commands.service';
import { EventStreamService } from '../sse/sse.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  FaultAlert,
  TelemetryProvider,
  TelemetrySourceLineage,
  UnifiedTelemetryData,
  VehicleCommandInput,
  VehicleCommandResult,
  VehicleCommandStatus,
  VehicleTelemetryProviderAdapter,
} from './telemetry.types';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const WRITE_DENIED_TENANT_ROLE_KEYS = new Set(['FLEET_DRIVER']);
const TELEMETRY_STALE_MS = 60_000;
const POLL_ACTIVE_MS = 30_000;
const POLL_IDLE_MS = 180_000;
type TelemetryBattery = UnifiedTelemetryData['battery'];
type TelemetryGps = NonNullable<UnifiedTelemetryData['gps']>;
type TelemetryOdometer = UnifiedTelemetryData['odometer'];
type TelemetryCharging = UnifiedTelemetryData['charging'];
type ChargingStatus = NonNullable<TelemetryCharging['status']>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function providerFrom(value: unknown): TelemetryProvider {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : 'MOCK';
  if (
    raw === 'SMARTCAR' ||
    raw === 'ENODE' ||
    raw === 'AUTOPI' ||
    raw === 'OPENDBC' ||
    raw === 'MQTT_BMS' ||
    raw === 'OBD_DONGLE' ||
    raw === 'OEM_API' ||
    raw === 'MANUAL_IMPORT' ||
    raw === 'MOCK'
  ) {
    return raw;
  }
  return 'MOCK';
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function toNullableJsonInput(
  value: unknown,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return toInputJsonValue(value);
}

function parseLineage(value: unknown): TelemetrySourceLineage | null {
  const source = asRecord(value);
  const provider = stringOrNull(source.provider);
  if (!provider) return null;

  return {
    provider: providerFrom(provider),
    providerId: stringOrNull(source.providerId),
    lastSyncedAt: stringOrNull(source.lastSyncedAt),
    freshnessMs: numberOrNull(source.freshnessMs),
    isStale: Boolean(source.isStale),
  };
}

function computeFreshnessMs(lastSyncedAt: string | null): number | null {
  if (!lastSyncedAt) return null;
  const parsed = Date.parse(lastSyncedAt);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Date.now() - parsed);
}

function isChargingStatus(value: string): value is ChargingStatus {
  return (
    value === 'IDLE' ||
    value === 'CHARGING' ||
    value === 'COMPLETED' ||
    value === 'FAULTED'
  );
}

function buildLineage(
  provider: TelemetryProvider,
  providerId: string | null,
  lastSyncedAt: string | null,
): TelemetrySourceLineage {
  const freshnessMs = computeFreshnessMs(lastSyncedAt);
  return {
    provider,
    providerId,
    lastSyncedAt,
    freshnessMs,
    isStale: freshnessMs === null ? true : freshnessMs > TELEMETRY_STALE_MS,
  };
}

function normalizeFaults(vehicleId: string, value: unknown): FaultAlert[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const row = asRecord(item);
      const severity = stringOrNull(row.severity);
      if (!severity || !['INFO', 'WARNING', 'CRITICAL'].includes(severity)) {
        return null;
      }
      return {
        id: stringOrNull(row.id) || `${vehicleId}_fault_${index}`,
        vehicleId: stringOrNull(row.vehicleId) || vehicleId,
        code: stringOrNull(row.code) || 'UNKNOWN',
        severity: severity as 'INFO' | 'WARNING' | 'CRITICAL',
        description: stringOrNull(row.description) || 'Unknown fault',
        timestamp: stringOrNull(row.timestamp) || nowIso(),
      } as FaultAlert;
    })
    .filter((item): item is FaultAlert => Boolean(item));
}

class SyntheticTelemetryAdapter implements VehicleTelemetryProviderAdapter {
  constructor(readonly provider: TelemetryProvider) {}

  async fetchStatus(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    lastKnown?: UnifiedTelemetryData | null;
  }): Promise<UnifiedTelemetryData> {
    const wave = Math.sin(Date.now() / 90_000);
    const socBase: Record<TelemetryProvider, number> = {
      SMARTCAR: 64,
      ENODE: 61,
      AUTOPI: 58,
      OPENDBC: 57,
      MQTT_BMS: 55,
      OBD_DONGLE: 56,
      OEM_API: 63,
      MANUAL_IMPORT: 59,
      MOCK: 62,
    };

    const providerId = input.providerVehicleId || `${this.provider.toLowerCase()}:${input.vehicleId}`;
    const lastSyncedAt = nowIso();
    const lineage = buildLineage(this.provider, providerId, lastSyncedAt);
    const gpsEnabled =
      this.provider === 'AUTOPI' ||
      this.provider === 'OPENDBC' ||
      this.provider === 'ENODE' ||
      this.provider === 'OEM_API';

    return {
      vehicleId: input.vehicleId,
      provider: this.provider,
      providerId,
      lastSyncedAt,
      battery: {
        soh: numberOrNull(input.lastKnown?.battery.soh) ?? Number((91 + wave).toFixed(2)),
        soc: Number((Math.max(3, Math.min(100, socBase[this.provider] + wave * 2))).toFixed(2)),
        temperatureC: Number((31 + wave).toFixed(2)),
        voltageV: Number((392 + wave * 4).toFixed(2)),
        currentA: Number((16 + wave * 3).toFixed(2)),
        estimatedRangeKm: Number((210 + wave * 15).toFixed(1)),
      },
      gps: gpsEnabled
        ? {
            latitude: Number((0.3476 + wave * 0.0002).toFixed(6)),
            longitude: Number((32.5825 + wave * 0.0002).toFixed(6)),
            headingDeg: Number((90 + wave * 12).toFixed(1)),
            speedKph: Number((40 + wave * 8).toFixed(1)),
            altitudeM: 1189,
          }
        : null,
      odometer: {
        totalKm: Number((12500 + wave * 2).toFixed(1)),
        tripKm: Number((12 + wave * 2).toFixed(1)),
      },
      faults: input.lastKnown?.faults || [],
      charging: {
        status: input.lastKnown?.charging.status || 'IDLE',
        powerKw: input.lastKnown?.charging.powerKw ?? 0,
        isPluggedIn: input.lastKnown?.charging.isPluggedIn ?? false,
        chargeLimitPercent: input.lastKnown?.charging.chargeLimitPercent ?? 85,
      },
      sources: {
        battery: lineage,
        gps: gpsEnabled ? lineage : null,
        odometer: lineage,
        faults: lineage,
        charging: lineage,
        signals: {
          batterySoc: lineage,
          batterySoh: lineage,
          hvCurrent: lineage,
          hvVoltage: lineage,
          gpsSpeed: gpsEnabled ? lineage : null,
          gpsHeading: gpsEnabled ? lineage : null,
        },
      },
    };
  }
}

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private pollActiveTimer: NodeJS.Timeout | null = null;
  private pollIdleTimer: NodeJS.Timeout | null = null;
  private pollRunning = false;

  private readonly adapters = new Map<TelemetryProvider, VehicleTelemetryProviderAdapter>([
    ['MOCK', new SyntheticTelemetryAdapter('MOCK')],
    ['SMARTCAR', new SyntheticTelemetryAdapter('SMARTCAR')],
    ['ENODE', new SyntheticTelemetryAdapter('ENODE')],
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly commands: CommandsService,
    private readonly events: EventStreamService,
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService<Record<string, unknown>>,
  ) {}

  onModuleInit(): void {
    this.pollActiveTimer = setInterval(() => {
      void this.pollFleetTelemetry('active');
    }, POLL_ACTIVE_MS);

    this.pollIdleTimer = setInterval(() => {
      void this.pollFleetTelemetry('idle');
    }, POLL_IDLE_MS);
  }

  onModuleDestroy(): void {
    if (this.pollActiveTimer) {
      clearInterval(this.pollActiveTimer);
      this.pollActiveTimer = null;
    }
    if (this.pollIdleTimer) {
      clearInterval(this.pollIdleTimer);
      this.pollIdleTimer = null;
    }
  }

  async getVehicleStatus(
    userId: string,
    vehicleId: string,
    query?: { provider?: string; providerId?: string },
  ): Promise<UnifiedTelemetryData> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'read');

    const latest = await this.prisma.vehicleTelemetryLatest.findUnique({
      where: { vehicleId: vehicle.id },
    });

    if (latest) {
      const status = this.toUnifiedTelemetryFromLatest(vehicle.id, latest);
      if (!status.sources.battery?.isStale) {
        return status;
      }
    }

    const provider = providerFrom(query?.provider || vehicle.telemetryProvider);
    const adapter = this.adapters.get(provider) || this.adapters.get('MOCK');
    const lastKnown = latest
      ? this.toUnifiedTelemetryFromLatest(vehicle.id, latest)
      : null;

    const fetched = await adapter!.fetchStatus({
      vehicleId: vehicle.id,
      providerVehicleId: query?.providerId || undefined,
      lastKnown,
    });

    await this.persistTelemetrySnapshot(vehicle.id, fetched, { rawPayload: null });
    await this.syncFaultLifecycle(vehicle, fetched.faults, 'provider-sync');
    await this.emitVehicleEvent('vehicle.telemetry.updated', {
      vehicleId: vehicle.id,
      provider: fetched.provider,
      lastSyncedAt: fetched.lastSyncedAt,
      stale: fetched.sources.battery?.isStale ?? true,
    }, vehicle.organizationId || undefined);

    if (fetched.battery.soc !== null && fetched.battery.soc <= 20) {
      await this.emitVehicleEvent('vehicle.low_soc', {
        vehicleId: vehicle.id,
        soc: fetched.battery.soc,
      }, vehicle.organizationId || undefined);
    }

    if (
      fetched.battery.temperatureC !== null &&
      fetched.battery.temperatureC >= 45
    ) {
      await this.emitVehicleEvent('vehicle.high_temperature', {
        vehicleId: vehicle.id,
        temperatureC: fetched.battery.temperatureC,
      }, vehicle.organizationId || undefined);
    }

    if (fetched.sources.battery?.isStale) {
      await this.emitVehicleEvent('vehicle.telemetry_stale', {
        vehicleId: vehicle.id,
        provider: fetched.provider,
      }, vehicle.organizationId || undefined);
    }

    return fetched;
  }

  async sendVehicleCommand(
    userId: string,
    vehicleId: string,
    input: {
      command: VehicleCommandInput;
      provider?: string;
      providerId?: string;
    },
  ): Promise<VehicleCommandResult> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'write');
    const provider = providerFrom(input.provider || vehicle.telemetryProvider);
    const providerVehicleId =
      input.providerId ||
      (await this.resolveProviderVehicleId(vehicle.id, provider)) ||
      vehicle.id;

    const queued = await this.commands.enqueueVehicleCommand({
      vehicleId: vehicle.id,
      tenantId: vehicle.organizationId || null,
      provider,
      providerVehicleId,
      commandType: input.command.type,
      payload: {
        ...asRecord(input.command),
        provider,
        providerId: providerVehicleId,
      },
      requestedBy: userId,
    });

    const result: VehicleCommandResult = {
      accepted: true,
      provider,
      providerCommandId: queued.providerCommandId,
      commandId: queued.commandId,
      status: 'QUEUED',
      errorCode: null,
    };

    await this.emitVehicleEvent('vehicle.command.updated', {
      vehicleId: vehicle.id,
      commandId: result.commandId,
      status: result.status,
      provider: result.provider,
    }, vehicle.organizationId || undefined);

    return result;
  }

  async getVehicleCommandStatus(
    userId: string,
    vehicleId: string,
    commandId: string,
  ): Promise<VehicleCommandResult> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'read');
    const command = await this.commands.getVehicleCommandById(commandId, vehicle.id);
    if (!command) {
      throw new NotFoundException('Vehicle command not found');
    }

    const status = this.mapCommandStatus(command.status);
    const provider = providerFrom(command.provider || vehicle.telemetryProvider);

    const result: VehicleCommandResult = {
      accepted: status !== 'FAILED',
      provider,
      providerCommandId: command.providerCommandId || null,
      commandId: command.id,
      status,
      errorCode: command.resultCode || command.error || null,
    };

    await this.emitVehicleEvent('vehicle.command.updated', {
      vehicleId: vehicle.id,
      commandId: result.commandId,
      status: result.status,
      provider: result.provider,
      errorCode: result.errorCode,
    }, vehicle.organizationId || undefined);

    return result;
  }

  async ingestProviderWebhook(
    provider: string,
    payload: Record<string, unknown>,
  ) {
    const normalizedProvider = providerFrom(provider);
    const body = asRecord(payload);

    const vehicle = await this.resolveVehicleForWebhook(
      stringOrNull(body.vehicleId),
      stringOrNull(body.providerVehicleId),
      normalizedProvider,
    );

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found for telemetry webhook payload');
    }

    const current = await this.prisma.vehicleTelemetryLatest.findUnique({
      where: { vehicleId: vehicle.id },
    });

    const fallback = current
      ? this.toUnifiedTelemetryFromLatest(vehicle.id, current)
      : this.emptyTelemetry(vehicle.id, normalizedProvider, vehicle.id);

    const status: UnifiedTelemetryData = {
      ...fallback,
      provider: normalizedProvider,
      providerId: stringOrNull(body.providerVehicleId) || fallback.providerId,
      lastSyncedAt: stringOrNull(body.lastSyncedAt) || nowIso(),
      battery: {
        ...fallback.battery,
        ...this.normalizeBattery(body.battery),
      },
      gps: this.normalizeGps(body.gps) ?? fallback.gps,
      odometer: {
        ...fallback.odometer,
        ...this.normalizeOdometer(body.odometer),
      },
      charging: {
        ...fallback.charging,
        ...this.normalizeCharging(body.charging),
      },
      faults: normalizeFaults(vehicle.id, body.faults),
      sources: this.normalizeSources(
        normalizedProvider,
        stringOrNull(body.providerVehicleId) || fallback.providerId,
        stringOrNull(body.lastSyncedAt) || nowIso(),
        body.sources,
      ),
    };

    await this.persistTelemetrySnapshot(vehicle.id, status, {
      rawPayload: body.rawPayload || body,
    });
    await this.syncFaultLifecycle(vehicle, status.faults, 'webhook');

    await this.emitVehicleEvent('vehicle.telemetry.updated', {
      vehicleId: vehicle.id,
      provider: normalizedProvider,
      source: 'webhook',
    }, vehicle.organizationId || undefined);

    return { ok: true };
  }

  private async pollFleetTelemetry(mode: 'active' | 'idle') {
    if (this.pollRunning) return;
    this.pollRunning = true;

    try {
      const providerSet: TelemetryProviderType[] = ['SMARTCAR', 'ENODE'];
      const where: Prisma.VehicleWhereInput = {
        telemetryProvider: { in: providerSet },
        vehicleStatus: 'ACTIVE',
      };

      const vehicles = await this.prisma.vehicle.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: mode === 'active' ? 100 : 200,
      });

      for (const vehicle of vehicles) {
        const adapter = this.adapters.get(providerFrom(vehicle.telemetryProvider));
        if (!adapter) continue;

        const latest = await this.prisma.vehicleTelemetryLatest.findUnique({
          where: { vehicleId: vehicle.id },
        });
        const lastKnown = latest
          ? this.toUnifiedTelemetryFromLatest(vehicle.id, latest)
          : null;

        if (mode === 'idle' && lastKnown?.charging.status === 'CHARGING') {
          continue;
        }

        const status = await adapter.fetchStatus({
          vehicleId: vehicle.id,
          providerVehicleId: await this.resolveProviderVehicleId(vehicle.id, providerFrom(vehicle.telemetryProvider)),
          lastKnown,
        });

        await this.persistTelemetrySnapshot(vehicle.id, status, { rawPayload: null });
        await this.syncFaultLifecycle(vehicle, status.faults, 'poll');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Telemetry poll (${mode}) failed: ${message}`);
    } finally {
      this.pollRunning = false;
    }
  }

  private async resolveProviderVehicleId(
    vehicleId: string,
    provider: TelemetryProvider,
  ): Promise<string | null> {
    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: { vehicleId, provider, enabled: true },
      orderBy: { updatedAt: 'desc' },
    });
    return source?.providerVehicleId || null;
  }

  private async resolveVehicleForWebhook(
    vehicleId: string | null,
    providerVehicleId: string | null,
    provider: TelemetryProvider,
  ) {
    if (vehicleId) {
      return this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    }

    if (!providerVehicleId) return null;

    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: { provider, providerVehicleId, enabled: true },
      include: { vehicle: true },
      orderBy: { updatedAt: 'desc' },
    });

    return source?.vehicle || null;
  }

  private async findAccessibleVehicle(
    vehicleId: string,
    userId: string,
    mode: 'read' | 'write',
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    if (vehicle.organizationId) {
      await this.assertTenantAccess(userId, vehicle.organizationId, mode);
      return vehicle;
    }

    if (vehicle.userId !== userId) {
      throw new ForbiddenException('Not your vehicle');
    }

    return vehicle;
  }

  private async assertTenantAccess(
    userId: string,
    organizationId: string,
    mode: 'read' | 'write',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role && PLATFORM_ADMIN_ROLES.has(user.role)) {
      return;
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
      select: { roleKey: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'User must be an active tenant member for this vehicle scope',
      );
    }

    if (
      mode === 'write' &&
      membership.roleKey &&
      WRITE_DENIED_TENANT_ROLE_KEYS.has(membership.roleKey.toUpperCase())
    ) {
      throw new ForbiddenException(
        `Tenant role ${membership.roleKey} cannot modify fleet vehicles`,
      );
    }

    const tenantId = this.resolveTenantId();
    if (tenantId && tenantId !== organizationId) {
      throw new ForbiddenException('Active tenant context does not match vehicle tenant');
    }
  }

  private resolveTenantId(): string | null {
    const ctx = this.tenantContext.get();
    return ctx?.effectiveOrganizationId || ctx?.authenticatedOrganizationId || null;
  }

  private normalizeBattery(value: unknown): TelemetryBattery {
    const battery = asRecord(value);
    return {
      soh: numberOrNull(battery.soh),
      soc: numberOrNull(battery.soc),
      temperatureC: numberOrNull(battery.temperatureC),
      voltageV: numberOrNull(battery.voltageV),
      currentA: numberOrNull(battery.currentA),
      estimatedRangeKm: numberOrNull(battery.estimatedRangeKm),
    };
  }

  private normalizeGps(value: unknown): TelemetryGps | null {
    const gps = asRecord(value);
    if (!Object.keys(gps).length) return null;

    return {
      latitude: numberOrNull(gps.latitude),
      longitude: numberOrNull(gps.longitude),
      headingDeg: numberOrNull(gps.headingDeg),
      speedKph: numberOrNull(gps.speedKph),
      altitudeM: numberOrNull(gps.altitudeM),
    };
  }

  private normalizeOdometer(value: unknown): TelemetryOdometer {
    const odometer = asRecord(value);
    return {
      totalKm: numberOrNull(odometer.totalKm),
      tripKm: numberOrNull(odometer.tripKm),
    };
  }

  private normalizeCharging(value: unknown): TelemetryCharging {
    const charging = asRecord(value);
    const status = stringOrNull(charging.status);
    return {
      status: status && isChargingStatus(status) ? status : null,
      powerKw: numberOrNull(charging.powerKw),
      isPluggedIn: boolOrNull(charging.isPluggedIn),
      chargeLimitPercent: numberOrNull(charging.chargeLimitPercent),
    };
  }

  private normalizeSources(
    provider: TelemetryProvider,
    providerId: string | null,
    lastSyncedAt: string,
    value: unknown,
  ): UnifiedTelemetryData['sources'] {
    const fallback = buildLineage(provider, providerId, lastSyncedAt);
    const sources = asRecord(value);
    const signals = asRecord(sources.signals);

    return {
      battery: parseLineage(sources.battery) || fallback,
      gps: parseLineage(sources.gps) || fallback,
      odometer: parseLineage(sources.odometer) || fallback,
      faults: parseLineage(sources.faults) || fallback,
      charging: parseLineage(sources.charging) || fallback,
      signals: {
        batterySoc: parseLineage(signals.batterySoc) || fallback,
        batterySoh: parseLineage(signals.batterySoh) || fallback,
        hvCurrent: parseLineage(signals.hvCurrent) || fallback,
        hvVoltage: parseLineage(signals.hvVoltage) || fallback,
        gpsSpeed: parseLineage(signals.gpsSpeed) || fallback,
        gpsHeading: parseLineage(signals.gpsHeading) || fallback,
      },
    };
  }

  private toUnifiedTelemetryFromLatest(
    vehicleId: string,
    latest: Record<string, unknown>,
  ): UnifiedTelemetryData {
    const provider = providerFrom(latest.provider);
    const providerId = stringOrNull(latest.providerVehicleId) || vehicleId;
    const lastSyncedAt = stringOrNull(latest.lastSyncedAt) || nowIso();
    const fallbackLineage = buildLineage(provider, providerId, lastSyncedAt);
    const battery = asRecord(latest.battery);
    const odometer = asRecord(latest.odometer);
    const charging = asRecord(latest.charging);
    const sources = asRecord(latest.sources);
    const signals = asRecord(sources.signals);

    const gpsData = asRecord(latest.gps);
    const hasGps = Object.keys(gpsData).length > 0;

    return {
      vehicleId,
      provider,
      providerId,
      lastSyncedAt,
      battery: {
        soh: numberOrNull(battery.soh),
        soc: numberOrNull(battery.soc),
        temperatureC: numberOrNull(battery.temperatureC),
        voltageV: numberOrNull(battery.voltageV),
        currentA: numberOrNull(battery.currentA),
        estimatedRangeKm: numberOrNull(battery.estimatedRangeKm),
      },
      gps: hasGps
        ? {
            latitude: numberOrNull(gpsData.latitude),
            longitude: numberOrNull(gpsData.longitude),
            headingDeg: numberOrNull(gpsData.headingDeg),
            speedKph: numberOrNull(gpsData.speedKph),
            altitudeM: numberOrNull(gpsData.altitudeM),
          }
        : null,
      odometer: {
        totalKm: numberOrNull(odometer.totalKm),
        tripKm: numberOrNull(odometer.tripKm),
      },
      faults: normalizeFaults(vehicleId, latest.faults),
      charging: {
        status: (() => {
          const status = stringOrNull(charging.status);
          if (status && isChargingStatus(status)) {
            return status;
          }
          return null;
        })(),
        powerKw: numberOrNull(charging.powerKw),
        isPluggedIn: boolOrNull(charging.isPluggedIn),
        chargeLimitPercent: numberOrNull(charging.chargeLimitPercent),
      },
      sources: {
        battery: parseLineage(sources.battery) || fallbackLineage,
        gps: parseLineage(sources.gps) || (hasGps ? fallbackLineage : null),
        odometer: parseLineage(sources.odometer) || fallbackLineage,
        faults: parseLineage(sources.faults) || fallbackLineage,
        charging: parseLineage(sources.charging) || fallbackLineage,
        signals: {
          batterySoc: parseLineage(signals.batterySoc) || fallbackLineage,
          batterySoh: parseLineage(signals.batterySoh) || fallbackLineage,
          hvCurrent: parseLineage(signals.hvCurrent) || fallbackLineage,
          hvVoltage: parseLineage(signals.hvVoltage) || fallbackLineage,
          gpsSpeed: parseLineage(signals.gpsSpeed) || (hasGps ? fallbackLineage : null),
          gpsHeading: parseLineage(signals.gpsHeading) || (hasGps ? fallbackLineage : null),
        },
      },
    };
  }

  private emptyTelemetry(
    vehicleId: string,
    provider: TelemetryProvider,
    providerId: string,
  ): UnifiedTelemetryData {
    const now = nowIso();
    const fallbackLineage = buildLineage(provider, providerId, now);

    return {
      vehicleId,
      provider,
      providerId,
      lastSyncedAt: now,
      battery: {
        soh: null,
        soc: null,
        temperatureC: null,
        voltageV: null,
        currentA: null,
        estimatedRangeKm: null,
      },
      gps: null,
      odometer: {
        totalKm: null,
        tripKm: null,
      },
      faults: [],
      charging: {
        status: null,
        powerKw: null,
        isPluggedIn: null,
        chargeLimitPercent: null,
      },
      sources: {
        battery: fallbackLineage,
        gps: null,
        odometer: fallbackLineage,
        faults: fallbackLineage,
        charging: fallbackLineage,
        signals: {
          batterySoc: fallbackLineage,
          batterySoh: fallbackLineage,
          hvCurrent: fallbackLineage,
          hvVoltage: fallbackLineage,
          gpsSpeed: null,
          gpsHeading: null,
        },
      },
    };
  }

  private async persistTelemetrySnapshot(
    vehicleId: string,
    status: UnifiedTelemetryData,
    input: { rawPayload: unknown },
  ) {
    const sampledAt = status.lastSyncedAt ? new Date(status.lastSyncedAt) : new Date();

    await this.prisma.vehicleTelemetrySnapshot.create({
      data: {
        vehicleId,
        provider: status.provider,
        providerVehicleId: status.providerId,
        collectedAt: sampledAt,
        lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
        battery: toInputJsonValue(status.battery),
        gps: toNullableJsonInput(status.gps),
        odometer: toInputJsonValue(status.odometer),
        charging: toInputJsonValue(status.charging),
        faults: toInputJsonValue(status.faults),
        sources: toInputJsonValue(status.sources),
        rawPayload: toNullableJsonInput(input.rawPayload),
      },
    });

    await this.prisma.vehicleTelemetryLatest.upsert({
      where: { vehicleId },
      create: {
        vehicleId,
        provider: status.provider,
        providerVehicleId: status.providerId,
        lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
        sampledAt,
        battery: toInputJsonValue(status.battery),
        gps: toNullableJsonInput(status.gps),
        odometer: toInputJsonValue(status.odometer),
        charging: toInputJsonValue(status.charging),
        faults: toInputJsonValue(status.faults),
        sources: toInputJsonValue(status.sources),
      },
      update: {
        provider: status.provider,
        providerVehicleId: status.providerId,
        lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
        sampledAt,
        battery: toInputJsonValue(status.battery),
        gps: toNullableJsonInput(status.gps),
        odometer: toInputJsonValue(status.odometer),
        charging: toInputJsonValue(status.charging),
        faults: toInputJsonValue(status.faults),
        sources: toInputJsonValue(status.sources),
      },
    });
  }

  private async syncFaultLifecycle(
    vehicle: { id: string; organizationId: string | null },
    faults: FaultAlert[],
    source: string,
  ) {
    const existing = await this.prisma.vehicleFault.findMany({
      where: {
        vehicleId: vehicle.id,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
    });

    const now = new Date();
    const incomingByCode = new Map<string, FaultAlert>();
    for (const fault of faults) {
      incomingByCode.set(fault.code, fault);
      const found = existing.find((row) => row.code === fault.code);

      if (!found) {
        const created = await this.prisma.vehicleFault.create({
          data: {
            vehicleId: vehicle.id,
            provider: 'MOCK',
            source,
            code: fault.code,
            severity: fault.severity,
            description: fault.description,
            status: 'OPEN',
            firstSeenAt: new Date(fault.timestamp),
            lastSeenAt: new Date(fault.timestamp),
          },
        });

        await this.emitVehicleEvent('vehicle.fault.detected', {
          vehicleId: vehicle.id,
          faultId: created.id,
          code: fault.code,
          severity: fault.severity,
        }, vehicle.organizationId || undefined);
      } else {
        await this.prisma.vehicleFault.update({
          where: { id: found.id },
          data: {
            severity: fault.severity,
            description: fault.description,
            lastSeenAt: new Date(fault.timestamp),
          },
        });
      }
    }

    for (const row of existing) {
      if (incomingByCode.has(row.code)) continue;

      await this.prisma.vehicleFault.update({
        where: { id: row.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedBy: 'provider-sync',
          lastSeenAt: now,
        },
      });

      await this.emitVehicleEvent('vehicle.fault.resolved', {
        vehicleId: vehicle.id,
        faultId: row.id,
        code: row.code,
      }, vehicle.organizationId || undefined);
    }
  }

  private mapCommandStatus(status: string): VehicleCommandStatus {
    const normalized = (status || '').trim().toUpperCase();
    if (normalized === 'QUEUED') return 'QUEUED';
    if (normalized === 'SENT') return 'SENT';
    if (normalized === 'CONFIRMED' || normalized === 'COMPLETED') return 'CONFIRMED';
    if (normalized === 'FAILED' || normalized === 'DEADLETTERED' || normalized === 'DEAD_LETTERED') {
      return 'FAILED';
    }

    if (normalized === 'QUEUED') return 'QUEUED';
    if (normalized === 'SENT') return 'SENT';

    const titled = (status || '').trim();
    if (titled === 'Queued') return 'QUEUED';
    if (titled === 'Sent') return 'SENT';
    if (titled === 'Confirmed') return 'CONFIRMED';
    if (titled === 'Failed' || titled === 'DeadLettered') return 'FAILED';

    return 'QUEUED';
  }

  private async emitVehicleEvent(
    eventType: string,
    payload: Record<string, unknown>,
    organizationId?: string,
  ) {
    this.events.emit(eventType, payload);
    await this.webhooks.dispatchEvent(eventType, payload, organizationId);
  }

  validateProviderWebhookSecret(secret: string | null): boolean {
    const expected = this.config.get<string>('TELEMETRY_PROVIDER_WEBHOOK_SECRET');
    if (!expected) return true;
    return Boolean(secret && secret === expected);
  }
}
