import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TelemetryProviderType, UserRole } from '@prisma/client';
import { TenantContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';
import { CommandsService } from '../commands/commands.service';
import { EventStreamService } from '../sse/sse.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SmartcarProviderService } from './smartcar-provider.service';
import { TelemetryGatesService } from './telemetry-gates.service';
import {
  FaultAlert,
  TelemetryFeatureGates,
  TelemetryProvider,
  TelemetrySourceLineage,
  TelemetryWebhookIngestResult,
  UnifiedTelemetryData,
  VehicleCommandInput,
  VehicleCommandResult,
  VehicleCommandStatus,
  VehicleTelemetryProviderAdapter,
  VehicleTelemetrySourceRecord,
} from './telemetry.types';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const WRITE_DENIED_TENANT_ROLE_KEYS = new Set(['FLEET_DRIVER']);
const TELEMETRY_STALE_MS = 60_000;
const POLL_ACTIVE_MS = 30_000;
const POLL_IDLE_MS = 180_000;
const INGEST_LAG_ALERT_THRESHOLD_MS = 120_000;
const STALE_ALERT_THRESHOLD_MS = 600_000;
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

function sanitizeCredentialRef(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 240) {
    throw new BadRequestException('credentialRef must be between 3 and 240 characters');
  }
  if (!/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(trimmed)) {
    throw new BadRequestException(
      'credentialRef must be a reference identifier (for example cred:tenant:vehicle:smartcar)',
    );
  }
  if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    throw new BadRequestException('credentialRef appears to contain a raw token');
  }
  return trimmed;
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
    private readonly gates: TelemetryGatesService,
    private readonly smartcar: SmartcarProviderService,
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

  async listTelemetrySources(
    userId: string,
    vehicleId: string,
  ): Promise<VehicleTelemetrySourceRecord[]> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'read');

    const rows = await this.prisma.vehicleTelemetrySource.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: [{ provider: 'asc' }, { updatedAt: 'desc' }],
    });

    return rows.map((row) => this.mapTelemetrySource(row));
  }

  async createTelemetrySource(
    userId: string,
    vehicleId: string,
    input: {
      provider?: string;
      providerId?: string | null;
      credentialRef: string;
      enabled?: boolean;
      capabilities?: Array<'READ' | 'COMMANDS'>;
      metadata?: Record<string, unknown>;
    },
  ): Promise<VehicleTelemetrySourceRecord> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'write');
    const provider = providerFrom(input.provider || vehicle.telemetryProvider);
    const credentialRef = sanitizeCredentialRef(input.credentialRef);
    const providerVehicleId =
      input.providerId && input.providerId.trim().length > 0
        ? input.providerId.trim()
        : `${provider.toLowerCase()}:${vehicle.id}`;
    const capabilities = this.normalizeCapabilities(input.capabilities);
    const metadata = input.metadata ? toInputJsonValue(input.metadata) : undefined;

    const created = await this.prisma.vehicleTelemetrySource.create({
      data: {
        vehicleId: vehicle.id,
        provider,
        providerVehicleId,
        credentialRef,
        enabled: input.enabled !== false,
        capabilities,
        health: 'UNKNOWN',
        metadata,
      },
    });

    return this.mapTelemetrySource(created);
  }

  async updateTelemetrySource(
    userId: string,
    vehicleId: string,
    sourceId: string,
    input: {
      providerId?: string | null;
      credentialRef?: string;
      enabled?: boolean;
      capabilities?: Array<'READ' | 'COMMANDS'>;
      metadata?: Record<string, unknown>;
    },
  ): Promise<VehicleTelemetrySourceRecord> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'write');
    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: { id: sourceId, vehicleId: vehicle.id },
    });
    if (!source) {
      throw new NotFoundException('Telemetry source not found');
    }

    const updates: Prisma.VehicleTelemetrySourceUpdateInput = {};
    if (input.providerId !== undefined) {
      updates.providerVehicleId = input.providerId ? input.providerId.trim() : null;
    }
    if (input.credentialRef !== undefined) {
      updates.credentialRef = sanitizeCredentialRef(input.credentialRef);
    }
    if (input.enabled !== undefined) {
      updates.enabled = input.enabled === true;
    }
    if (input.capabilities !== undefined) {
      updates.capabilities = this.normalizeCapabilities(input.capabilities);
    }
    if (input.metadata !== undefined) {
      updates.metadata = toInputJsonValue(input.metadata);
    }

    const updated = await this.prisma.vehicleTelemetrySource.update({
      where: { id: source.id },
      data: updates,
    });

    return this.mapTelemetrySource(updated);
  }

  async removeTelemetrySource(
    userId: string,
    vehicleId: string,
    sourceId: string,
  ): Promise<{ ok: true }> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'write');
    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: { id: sourceId, vehicleId: vehicle.id },
      select: { id: true },
    });
    if (!source) {
      throw new NotFoundException('Telemetry source not found');
    }

    await this.prisma.vehicleTelemetrySource.delete({ where: { id: source.id } });
    return { ok: true };
  }

  async setTelemetrySourceEnabled(
    userId: string,
    vehicleId: string,
    sourceId: string,
    enabled: boolean,
  ): Promise<VehicleTelemetrySourceRecord> {
    return this.updateTelemetrySource(userId, vehicleId, sourceId, { enabled });
  }

  async issueSmartcarToken(
    userId: string,
    input: { vehicleId: string; providerId?: string | null; credentialRef: string },
  ): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    credentialRef: string;
  }> {
    const vehicle = await this.findAccessibleVehicle(input.vehicleId, userId, 'write');
    this.assertGate(
      vehicle.organizationId,
      'reads',
      'Telemetry provider auth is disabled for this tenant',
    );

    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: {
        vehicleId: vehicle.id,
        provider: 'SMARTCAR',
        credentialRef: sanitizeCredentialRef(input.credentialRef),
        enabled: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!source || !source.credentialRef) {
      throw new NotFoundException('Enabled SMARTCAR telemetry source not found');
    }

    const sourceMetadata = asRecord(source.metadata);
    const authPayload = asRecord(sourceMetadata.smartcarAuth);

    const session = await this.smartcar.issueToken({
      credentialRef: source.credentialRef,
      sourceConfig: authPayload,
    });

    await this.persistSmartcarAuthState(source, session);
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      credentialRef: session.credentialRef,
    };
  }

  async refreshSmartcarToken(
    userId: string,
    input: { vehicleId: string; credentialRef: string; refreshToken: string },
  ): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    credentialRef: string;
  }> {
    const vehicle = await this.findAccessibleVehicle(input.vehicleId, userId, 'write');
    this.assertGate(
      vehicle.organizationId,
      'reads',
      'Telemetry provider auth is disabled for this tenant',
    );

    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: {
        vehicleId: vehicle.id,
        provider: 'SMARTCAR',
        credentialRef: sanitizeCredentialRef(input.credentialRef),
        enabled: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!source || !source.credentialRef) {
      throw new UnauthorizedException('Unknown Smartcar credentialRef');
    }

    const sourceMetadata = asRecord(source.metadata);
    const authPayload = asRecord(sourceMetadata.smartcarAuth);
    const session = await this.smartcar.refreshToken({
      credentialRef: source.credentialRef,
      refreshToken: input.refreshToken,
      sourceConfig: authPayload,
    });
    await this.persistSmartcarAuthState(source, session);

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      credentialRef: session.credentialRef,
    };
  }

  async getSmartcarVehicleStatus(
    userId: string,
    vehicleId: string,
    providerId?: string | null,
  ): Promise<UnifiedTelemetryData> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'read');
    this.assertGate(
      vehicle.organizationId,
      'reads',
      'Telemetry reads are disabled for this tenant',
    );

    const source = await this.resolveSmartcarSource(vehicle.id, providerId || null);
    if (!source || !source.providerVehicleId || !source.credentialRef) {
      throw new NotFoundException(
        'Enabled SMARTCAR telemetry source with credentialRef is required',
      );
    }

    const session = await this.smartcar.issueToken({
      credentialRef: source.credentialRef,
      sourceConfig: asRecord(asRecord(source.metadata).smartcarAuth),
    });
    await this.persistSmartcarAuthState(source, session);

    const snapshot = await this.smartcar.fetchStatus({
      providerVehicleId: source.providerVehicleId,
      accessToken: session.accessToken,
    });

    const status = this.buildSmartcarUnifiedTelemetry(vehicle.id, snapshot);
    await this.persistTelemetrySnapshot(vehicle.id, status, { rawPayload: null });
    await this.writeIngestAlertIfNeeded({
      provider: 'SMARTCAR',
      vehicleId: vehicle.id,
      providerId: snapshot.providerVehicleId,
      lastSyncedAt: status.lastSyncedAt,
      source: 'poll',
      message: 'Smartcar telemetry status pull freshness check',
    });

    await this.emitVehicleEvent(
      'vehicle.telemetry.updated',
      {
        vehicleId: vehicle.id,
        provider: 'SMARTCAR',
        source: 'provider_pull',
      },
      vehicle.organizationId || undefined,
    );

    return status;
  }

  async sendSmartcarVehicleCommand(
    userId: string,
    vehicleId: string,
    input: { providerId?: string | null; command: VehicleCommandInput },
  ): Promise<VehicleCommandResult> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'write');
    this.assertGate(
      vehicle.organizationId,
      'commandDispatch',
      'Telemetry command dispatch is disabled for this tenant',
    );

    const source = await this.resolveSmartcarSource(vehicle.id, input.providerId || null);
    if (!source || !source.providerVehicleId || !source.credentialRef) {
      throw new NotFoundException(
        'Enabled SMARTCAR telemetry source with credentialRef is required',
      );
    }

    const session = await this.smartcar.issueToken({
      credentialRef: source.credentialRef,
      sourceConfig: asRecord(asRecord(source.metadata).smartcarAuth),
    });
    await this.persistSmartcarAuthState(source, session);

    const providerResponse = await this.smartcar.sendCommand({
      providerVehicleId: source.providerVehicleId,
      accessToken: session.accessToken,
      command: input.command,
    });

    const now = new Date();
    const commandId = `cmd_${now.getTime().toString(36)}`;
    await this.prisma.command.create({
      data: {
        id: commandId,
        domain: 'VEHICLE',
        tenantId: vehicle.organizationId || null,
        stationId: null,
        chargePointId: null,
        connectorId: null,
        vehicleId: vehicle.id,
        provider: 'SMARTCAR',
        providerVehicleId: source.providerVehicleId,
        providerCommandId: providerResponse.providerCommandId,
        resultCode: null,
        commandType: input.command.type,
        payload: toInputJsonValue({
          ...asRecord(input.command),
          providerId: source.providerVehicleId,
        }),
        status: 'Sent',
        requestedBy: userId,
        requestedAt: now,
        sentAt: now,
        completedAt: null,
        correlationId: commandId,
        idempotencyTtlSec: null,
        error: null,
      },
    });

    const result: VehicleCommandResult = {
      accepted: true,
      provider: 'SMARTCAR',
      providerCommandId: providerResponse.providerCommandId,
      commandId,
      status: 'SENT',
      errorCode: null,
    };

    await this.emitVehicleEvent(
      'vehicle.command.updated',
      {
        vehicleId: vehicle.id,
        commandId: result.commandId,
        status: result.status,
        provider: result.provider,
      },
      vehicle.organizationId || undefined,
    );

    return result;
  }

  async getSmartcarVehicleCommandStatus(
    userId: string,
    vehicleId: string,
    commandId: string,
  ): Promise<VehicleCommandResult> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'read');
    this.assertGate(
      vehicle.organizationId,
      'commandDispatch',
      'Telemetry command dispatch is disabled for this tenant',
    );

    const command = await this.prisma.command.findFirst({
      where: {
        id: commandId,
        domain: 'VEHICLE',
        vehicleId: vehicle.id,
        provider: 'SMARTCAR',
      },
      select: {
        id: true,
        providerCommandId: true,
        resultCode: true,
        status: true,
        error: true,
      },
    });
    if (!command) {
      throw new NotFoundException('Smartcar vehicle command not found');
    }

    const status = this.mapCommandStatus(command.status);
    return {
      accepted: status !== 'FAILED',
      provider: 'SMARTCAR',
      providerCommandId: command.providerCommandId || null,
      commandId: command.id,
      status,
      errorCode: command.resultCode || command.error || null,
    };
  }

  async ingestSmartcarWebhook(
    payload: Record<string, unknown>,
    rawBody: string | null,
    signature: string | null,
  ): Promise<TelemetryWebhookIngestResult | { challenge: string }> {
    if (!rawBody || !this.smartcar.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid Smartcar webhook signature');
    }

    const eventType = stringOrNull(payload.eventType);
    const eventData = asRecord(payload.data);

    if (eventType === 'VERIFY') {
      const challenge = stringOrNull(eventData.challenge);
      if (!challenge) {
        throw new BadRequestException('VERIFY event missing challenge');
      }
      return this.smartcar.buildVerifyChallengeResponse(challenge);
    }

    const vehicleId =
      stringOrNull(payload.vehicleId) ||
      stringOrNull(asRecord(eventData.vehicle).id) ||
      stringOrNull(payload.providerVehicleId);
    if (!vehicleId) {
      throw new BadRequestException('Smartcar webhook payload missing vehicleId');
    }

    const vehicle = await this.resolveVehicleForWebhook(
      stringOrNull(payload.vehicleId),
      vehicleId,
      'SMARTCAR',
    );
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found for Smartcar webhook payload');
    }

    this.assertGate(
      vehicle.organizationId,
      'webhooks',
      'Telemetry webhooks are disabled for this tenant',
    );

    const status = await this.ingestProviderWebhook('SMARTCAR', {
      vehicleId: vehicle.id,
      providerVehicleId: vehicleId,
      lastSyncedAt: this.extractSmartcarWebhookTimestamp(payload),
      battery: this.extractSmartcarBatteryFromWebhook(payload),
      gps: this.extractSmartcarLocationFromWebhook(payload),
      odometer: this.extractSmartcarOdometerFromWebhook(payload),
      charging: this.extractSmartcarChargingFromWebhook(payload),
      rawPayload: payload,
    });

    const lastSyncedAt = this.extractSmartcarWebhookTimestamp(payload);
    const lagMs = this.computeLagMs(lastSyncedAt);

    const commandId = stringOrNull(payload.commandId);
    if (commandId) {
      await this.applySmartcarCommandWebhookStatus(commandId, payload);
    }

    return {
      accepted: (status as { ok?: boolean }).ok === true,
      provider: 'SMARTCAR',
      lagMs,
      isStale: lagMs === null ? true : lagMs > STALE_ALERT_THRESHOLD_MS,
    };
  }

  async listRawSnapshots(
    limit = 100,
  ): Promise<
    Array<{
      id: string;
      vehicleId: string;
      provider: TelemetryProvider;
      providerId: string | null;
      collectedAt: string;
      lastSyncedAt: string | null;
      createdAt: string;
    }>
  > {
    const take = Math.max(1, Math.min(500, Math.floor(limit) || 100));
    const rows = await this.prisma.vehicleTelemetrySnapshot.findMany({
      orderBy: { collectedAt: 'desc' },
      take,
      select: {
        id: true,
        vehicleId: true,
        provider: true,
        providerVehicleId: true,
        collectedAt: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      provider: providerFrom(row.provider),
      providerId: row.providerVehicleId || null,
      collectedAt: row.collectedAt.toISOString(),
      lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listTelemetryAlerts(limit = 100) {
    const take = Math.max(1, Math.min(500, Math.floor(limit) || 100));
    const rows = await this.prisma.telemetryIngestAlert.findMany({
      orderBy: { observedAt: 'desc' },
      take,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      provider: providerFrom(row.provider),
      providerId: row.providerVehicleId || null,
      vehicleId: row.vehicleId,
      observedAt: row.observedAt.toISOString(),
      lagMs: row.lagMs,
      message: row.message,
      metadata: row.metadata,
    }));
  }

  async runTelemetryRetentionMaintenance(): Promise<{
    removed: number;
    retentionDays: number;
  }> {
    const retentionDays = 90;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.vehicleTelemetrySnapshot.deleteMany({
      where: { collectedAt: { lt: cutoff } },
    });

    return {
      removed: result.count,
      retentionDays,
    };
  }

  async getVehicleStatus(
    userId: string,
    vehicleId: string,
    query?: { provider?: string; providerId?: string },
  ): Promise<UnifiedTelemetryData> {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'read');
    this.assertGate(
      vehicle.organizationId,
      'reads',
      'Telemetry reads are disabled for this tenant',
    );

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
    if (provider === 'SMARTCAR') {
      const source = await this.resolveSmartcarSource(vehicle.id, query?.providerId || null);
      if (source?.enabled && source.credentialRef && source.providerVehicleId) {
        return this.getSmartcarVehicleStatus(userId, vehicleId, query?.providerId || null);
      }
    }
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
    await this.syncFaultLifecycle(vehicle, fetched.faults, 'provider-sync', fetched.provider);
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
    this.assertGate(
      vehicle.organizationId,
      'commandDispatch',
      'Telemetry command dispatch is disabled for this tenant',
    );
    const provider = providerFrom(input.provider || vehicle.telemetryProvider);
    if (provider === 'SMARTCAR') {
      const source = await this.resolveSmartcarSource(vehicle.id, input.providerId || null);
      if (source?.enabled && source.credentialRef && source.providerVehicleId) {
        return this.sendSmartcarVehicleCommand(userId, vehicleId, {
          providerId: input.providerId || null,
          command: input.command,
        });
      }
    }
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
    this.assertGate(
      vehicle.organizationId,
      'commandDispatch',
      'Telemetry command dispatch is disabled for this tenant',
    );
    const command = await this.commands.getVehicleCommandById(commandId, vehicle.id);
    if (!command) {
      throw new NotFoundException('Vehicle command not found');
    }

    const status = this.mapCommandStatus(command.status);
    const provider = providerFrom(command.provider || vehicle.telemetryProvider);
    if (provider === 'SMARTCAR') {
      return this.getSmartcarVehicleCommandStatus(userId, vehicleId, commandId);
    }

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
    this.assertGate(
      vehicle.organizationId,
      'webhooks',
      'Telemetry webhooks are disabled for this tenant',
    );

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
    await this.syncFaultLifecycle(vehicle, status.faults, 'webhook', normalizedProvider);

    await this.emitVehicleEvent('vehicle.telemetry.updated', {
      vehicleId: vehicle.id,
      provider: normalizedProvider,
      source: 'webhook',
    }, vehicle.organizationId || undefined);

    const lastSyncedAt = stringOrNull(body.lastSyncedAt) || status.lastSyncedAt;
    const lagMs = this.computeLagMs(lastSyncedAt);
    await this.writeIngestAlertIfNeeded({
      provider: normalizedProvider,
      providerId: status.providerId,
      vehicleId: vehicle.id,
      lastSyncedAt,
      source: 'webhook',
      lagMs,
      message: `${normalizedProvider} telemetry webhook ingest lag/staleness check`,
    });

    return {
      ok: true,
      accepted: true,
      provider: normalizedProvider,
      lagMs,
      isStale: lagMs === null ? true : lagMs > STALE_ALERT_THRESHOLD_MS,
    };
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
        const tenantGates = this.gates.resolve(vehicle.organizationId || null);
        if (!tenantGates.reads) {
          continue;
        }

        const provider = providerFrom(vehicle.telemetryProvider);
        const adapter = this.adapters.get(provider);
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

        let status: UnifiedTelemetryData;
        if (provider === 'SMARTCAR') {
          const source = await this.resolveSmartcarSource(vehicle.id, null);
          if (source?.enabled && source.credentialRef && source.providerVehicleId) {
            const session = await this.smartcar.issueToken({
              credentialRef: source.credentialRef,
              sourceConfig: asRecord(asRecord(source.metadata).smartcarAuth),
            });
            await this.persistSmartcarAuthState(source, session);
            const snapshot = await this.smartcar.fetchStatus({
              providerVehicleId: source.providerVehicleId,
              accessToken: session.accessToken,
            });
            status = this.buildSmartcarUnifiedTelemetry(vehicle.id, snapshot);
          } else {
            status = await adapter.fetchStatus({
              vehicleId: vehicle.id,
              providerVehicleId: await this.resolveProviderVehicleId(vehicle.id, provider),
              lastKnown,
            });
          }
        } else {
          status = await adapter.fetchStatus({
            vehicleId: vehicle.id,
            providerVehicleId: await this.resolveProviderVehicleId(vehicle.id, provider),
            lastKnown,
          });
        }

        await this.persistTelemetrySnapshot(vehicle.id, status, { rawPayload: null });
        await this.syncFaultLifecycle(vehicle, status.faults, 'poll', status.provider);
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

    await this.prisma.vehicleTelemetrySource.updateMany({
      where: {
        vehicleId,
        provider: status.provider,
        ...(status.providerId ? { providerVehicleId: status.providerId } : {}),
      },
      data: {
        lastSyncedAt: sampledAt,
        health: 'HEALTHY',
      },
    });
  }

  private async syncFaultLifecycle(
    vehicle: { id: string; organizationId: string | null },
    faults: FaultAlert[],
    source: string,
    provider: TelemetryProvider,
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
            provider,
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

  private mapTelemetrySource(source: {
    id: string;
    vehicleId: string;
    provider: TelemetryProviderType;
    providerVehicleId: string | null;
    credentialRef: string | null;
    enabled: boolean;
    capabilities: unknown[] | null;
    health: string;
    lastSyncedAt: Date | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): VehicleTelemetrySourceRecord {
    const capabilities: Array<'READ' | 'COMMANDS'> = Array.isArray(
      source.capabilities,
    )
      ? source.capabilities
          .map((item) => String(item).toUpperCase())
          .filter((item): item is 'READ' | 'COMMANDS' =>
            item === 'READ' || item === 'COMMANDS',
          )
      : ['READ'];

    const normalizedHealth: VehicleTelemetrySourceRecord['health'] =
      source.health === 'HEALTHY' ||
      source.health === 'DEGRADED' ||
      source.health === 'OFFLINE' ||
      source.health === 'UNKNOWN'
        ? source.health
        : 'UNKNOWN';

    return {
      id: source.id,
      vehicleId: source.vehicleId,
      provider: providerFrom(source.provider),
      providerId: source.providerVehicleId,
      credentialRef: source.credentialRef,
      enabled: source.enabled,
      capabilities: capabilities.length > 0 ? capabilities : ['READ'],
      health: normalizedHealth,
      lastSyncedAt: source.lastSyncedAt ? source.lastSyncedAt.toISOString() : null,
      metadata: source.metadata ? asRecord(source.metadata) : null,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  }

  private normalizeCapabilities(
    value?: Array<'READ' | 'COMMANDS'>,
  ): Array<'READ' | 'COMMANDS'> {
    if (!value || value.length === 0) {
      return ['READ'];
    }
    const unique = Array.from(
      new Set(
        value
          .map((item) => item.toUpperCase())
          .filter((item): item is 'READ' | 'COMMANDS' =>
            item === 'READ' || item === 'COMMANDS',
          ),
      ),
    );
    return unique.length > 0 ? unique : ['READ'];
  }

  private assertGate(
    organizationId: string | null,
    gateKey: keyof TelemetryFeatureGates,
    message: string,
  ): void {
    const gate = this.gates.resolve(organizationId);
    if (gate[gateKey] === false) {
      throw new ForbiddenException(message);
    }
  }

  private async resolveSmartcarSource(
    vehicleId: string,
    providerId: string | null,
  ) {
    return this.prisma.vehicleTelemetrySource.findFirst({
      where: {
        vehicleId,
        provider: 'SMARTCAR',
        enabled: true,
        ...(providerId ? { providerVehicleId: providerId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async persistSmartcarAuthState(
    source: { id: string; metadata: unknown },
    session: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: string | null;
      credentialRef: string;
    },
  ): Promise<void> {
    const metadata = asRecord(source.metadata);
    const existingAuth = asRecord(metadata.smartcarAuth);

    await this.prisma.vehicleTelemetrySource.update({
      where: { id: source.id },
      data: {
        metadata: toInputJsonValue({
          ...metadata,
          smartcarAuth: {
            ...existingAuth,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            accessTokenExpiresAt: session.expiresAt,
            credentialRef: session.credentialRef,
            updatedAt: nowIso(),
          },
        }),
      },
    });
  }

  private buildSmartcarUnifiedTelemetry(
    vehicleId: string,
    snapshot: {
      providerVehicleId: string;
      batterySoc: number | null;
      rangeKm: number | null;
      isPluggedIn: boolean | null;
      chargeState: string | null;
      chargeLimitPercent: number | null;
      odometerKm: number | null;
      latitude: number | null;
      longitude: number | null;
      isLocked: boolean | null;
    },
  ): UnifiedTelemetryData {
    const lastSyncedAt = nowIso();
    const lineage = buildLineage('SMARTCAR', snapshot.providerVehicleId, lastSyncedAt);
    const hasGps =
      typeof snapshot.latitude === 'number' && typeof snapshot.longitude === 'number';

    return {
      vehicleId,
      provider: 'SMARTCAR',
      providerId: snapshot.providerVehicleId,
      lastSyncedAt,
      battery: {
        soh: null,
        soc: snapshot.batterySoc,
        temperatureC: null,
        voltageV: null,
        currentA: null,
        estimatedRangeKm: snapshot.rangeKm,
      },
      gps: hasGps
        ? {
            latitude: snapshot.latitude,
            longitude: snapshot.longitude,
            headingDeg: null,
            speedKph: null,
            altitudeM: null,
          }
        : null,
      odometer: {
        totalKm: snapshot.odometerKm,
        tripKm: null,
      },
      faults: [],
      charging: {
        status: this.mapSmartcarChargeState(snapshot.chargeState),
        powerKw: null,
        isPluggedIn: snapshot.isPluggedIn,
        chargeLimitPercent: snapshot.chargeLimitPercent,
      },
      sources: {
        battery: lineage,
        gps: hasGps ? lineage : null,
        odometer: lineage,
        faults: lineage,
        charging: lineage,
        signals: {
          batterySoc: lineage,
          batterySoh: lineage,
          hvCurrent: lineage,
          hvVoltage: lineage,
          gpsSpeed: hasGps ? lineage : null,
          gpsHeading: hasGps ? lineage : null,
        },
      },
    };
  }

  private mapSmartcarChargeState(value: string | null): ChargingStatus | null {
    const normalized = (value || '').trim().toUpperCase();
    if (normalized === 'CHARGING') return 'CHARGING';
    if (normalized === 'FULLY_CHARGED') return 'COMPLETED';
    if (normalized === 'NOT_CHARGING') return 'IDLE';
    return null;
  }

  private computeLagMs(lastSyncedAt: string | null): number | null {
    if (!lastSyncedAt) return null;
    const parsed = Date.parse(lastSyncedAt);
    if (Number.isNaN(parsed)) return null;
    return Math.max(0, Date.now() - parsed);
  }

  private extractSmartcarWebhookTimestamp(payload: Record<string, unknown>): string | null {
    const data = asRecord(payload.data);
    const meta = asRecord(payload.meta);
    const deliveredAt = meta.deliveredAt;

    if (typeof deliveredAt === 'number' && Number.isFinite(deliveredAt)) {
      return new Date(deliveredAt).toISOString();
    }

    const fromPayload =
      stringOrNull(payload.timestamp) ||
      stringOrNull(data.timestamp) ||
      stringOrNull(data.eventTime);
    return fromPayload || nowIso();
  }

  private extractSmartcarBatteryFromWebhook(payload: Record<string, unknown>) {
    const fromPayload = asRecord(payload.battery);
    const data = asRecord(payload.data);
    const fromData = asRecord(data.battery);
    const resolved = Object.keys(fromPayload).length ? fromPayload : fromData;

    return {
      soc: numberOrNull(resolved.soc) ?? numberOrNull(resolved.percentRemaining),
      estimatedRangeKm:
        numberOrNull(resolved.estimatedRangeKm) ?? numberOrNull(resolved.range),
    };
  }

  private extractSmartcarLocationFromWebhook(payload: Record<string, unknown>) {
    const fromPayload = asRecord(payload.gps);
    const data = asRecord(payload.data);
    const fromData = asRecord(data.location);
    const resolved = Object.keys(fromPayload).length ? fromPayload : fromData;
    if (Object.keys(resolved).length === 0) return null;

    return {
      latitude: numberOrNull(resolved.latitude),
      longitude: numberOrNull(resolved.longitude),
    };
  }

  private extractSmartcarOdometerFromWebhook(payload: Record<string, unknown>) {
    const fromPayload = asRecord(payload.odometer);
    const data = asRecord(payload.data);
    const fromData = asRecord(data.odometer);
    const resolved = Object.keys(fromPayload).length ? fromPayload : fromData;

    return {
      totalKm: numberOrNull(resolved.totalKm) ?? numberOrNull(resolved.distance),
    };
  }

  private extractSmartcarChargingFromWebhook(payload: Record<string, unknown>) {
    const fromPayload = asRecord(payload.charging);
    const data = asRecord(payload.data);
    const fromData = asRecord(data.charge);
    const resolved = Object.keys(fromPayload).length ? fromPayload : fromData;

    const status =
      stringOrNull(resolved.status) || this.mapSmartcarChargeState(stringOrNull(resolved.state));

    return {
      status: status && isChargingStatus(status) ? status : null,
      isPluggedIn: boolOrNull(resolved.isPluggedIn),
      chargeLimitPercent:
        numberOrNull(resolved.chargeLimitPercent) ??
        (numberOrNull(resolved.limit) !== null
          ? Number((Number(resolved.limit) * 100).toFixed(2))
          : null),
    };
  }

  private async applySmartcarCommandWebhookStatus(
    commandId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const statusRaw =
      stringOrNull(payload.status) ||
      stringOrNull(asRecord(payload.data).status) ||
      stringOrNull(asRecord(payload.data).eventType);
    if (!statusRaw) return;

    const normalized = statusRaw.trim().toUpperCase();
    const mapped =
      normalized === 'FAILED' || normalized.includes('ERROR')
        ? 'Failed'
        : normalized === 'CONFIRMED' ||
            normalized === 'COMPLETED' ||
            normalized.includes('STOPPED')
          ? 'Confirmed'
          : normalized === 'SENT'
            ? 'Sent'
            : normalized === 'QUEUED'
              ? 'Queued'
              : null;

    if (!mapped) return;

    await this.prisma.command.updateMany({
      where: { id: commandId, provider: 'SMARTCAR', domain: 'VEHICLE' },
      data: {
        status: mapped,
        completedAt:
          mapped === 'Confirmed' || mapped === 'Failed' ? new Date() : undefined,
      },
    });
  }

  private async writeIngestAlertIfNeeded(input: {
    provider: TelemetryProvider;
    providerId: string | null;
    vehicleId: string;
    lastSyncedAt: string | null;
    source: 'poll' | 'webhook';
    lagMs?: number | null;
    message: string;
  }): Promise<void> {
    const lagMs = input.lagMs ?? this.computeLagMs(input.lastSyncedAt);
    const shouldWriteLag =
      lagMs !== null && lagMs > this.readPositiveInt('TELEMETRY_INGEST_LAG_ALERT_THRESHOLD_MS', INGEST_LAG_ALERT_THRESHOLD_MS);
    const shouldWriteStale =
      lagMs === null ||
      lagMs > this.readPositiveInt('TELEMETRY_STALENESS_ALERT_THRESHOLD_MS', STALE_ALERT_THRESHOLD_MS);

    if (!shouldWriteLag && !shouldWriteStale) {
      return;
    }

    const now = new Date();
    if (shouldWriteLag) {
      await this.prisma.telemetryIngestAlert.create({
        data: {
          type: 'INGEST_LAG',
          provider: input.provider,
          providerVehicleId: input.providerId,
          vehicleId: input.vehicleId,
          observedAt: now,
          lagMs,
          message: input.message,
          metadata: toInputJsonValue({
            source: input.source,
            lastSyncedAt: input.lastSyncedAt,
          }),
        },
      });
    }

    if (shouldWriteStale) {
      await this.prisma.telemetryIngestAlert.create({
        data: {
          type: 'STALE',
          provider: input.provider,
          providerVehicleId: input.providerId,
          vehicleId: input.vehicleId,
          observedAt: now,
          lagMs,
          message: `${input.message} (stale)`,
          metadata: toInputJsonValue({
            source: input.source,
            lastSyncedAt: input.lastSyncedAt,
          }),
        },
      });
    }
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.floor(parsed);
    return rounded > 0 ? rounded : fallback;
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
    const gate = this.gates.resolve(organizationId || null);
    if (gate.sse) {
      this.events.emit(eventType, payload);
    }
    if (gate.webhooks) {
      await this.webhooks.dispatchEvent(eventType, payload, organizationId);
    }
  }

  validateProviderWebhookSecret(secret: string | null): boolean {
    const expected = this.config.get<string>('TELEMETRY_PROVIDER_WEBHOOK_SECRET');
    if (!expected) return true;
    return Boolean(secret && secret === expected);
  }
}
