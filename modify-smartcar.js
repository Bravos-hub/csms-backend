const fs = require('fs');

let content = fs.readFileSync('apps/api/src/modules/telemetry/smartcar-provider.service.ts', 'utf8');

// 1. Update imports
content = content.replace(
  "import { VehicleCommandInput } from './telemetry.types';",
  `import { PrismaService } from '../../prisma.service';
import {
  TelemetryProvider,
  UnifiedTelemetryData,
  VehicleCommandInput,
  VehicleTelemetryProviderAdapter,
} from './telemetry.types';`
);

// 2. Add buildLineage and nowIso helpers before @Injectable
content = content.replace(
  '@Injectable()',
  `function buildLineage(
  provider: TelemetryProvider,
  providerId: string | null,
  lastSyncedAt: string | null,
): {
  provider: TelemetryProvider;
  providerId: string | null;
  lastSyncedAt: string | null;
  freshnessMs: number | null;
  isStale: boolean;
} {
  const freshnessMs = lastSyncedAt ? Math.max(0, Date.now() - Date.parse(lastSyncedAt)) : null;
  return {
    provider,
    providerId,
    lastSyncedAt,
    freshnessMs,
    isStale: freshnessMs === null ? true : freshnessMs > 60_000,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

@Injectable()`
);

// 3. Update constructor to include PrismaService and provider field + cache
content = content.replace(
  `export class SmartcarProviderService {
  constructor(
    private readonly config: ConfigService<Record<string, unknown>>,
  ) {}`,
  `export class SmartcarProviderService implements VehicleTelemetryProviderAdapter {
  provider = 'SMARTCAR' as TelemetryProvider;
  private readonly authTokenCache = new Map<string, SmartcarTokenSession>();

  constructor(
    private readonly config: ConfigService<Record<string, unknown>>,
    private readonly prisma: PrismaService,
  ) {}`
);

// 4. Rename fetchStatus -> fetchVehicleSnapshot
content = content.replace(
  /async fetchStatus\(input: \{\n    providerVehicleId: string;\n    accessToken: string;\n  }\): Promise<SmartcarStatusSnapshot>/g,
  'async fetchVehicleSnapshot(input: {\n    providerVehicleId: string;\n    accessToken: string;\n  }): Promise<SmartcarStatusSnapshot>'
);

// 5. Rename sendCommand -> dispatchVehicleCommand  
content = content.replace(
  /async sendCommand\(input: \{\n    providerVehicleId: string;\n    accessToken: string;\n    command: VehicleCommandInput;\n  }\): Promise<SmartcarCommandResult>/g,
  'async dispatchVehicleCommand(input: {\n    providerVehicleId: string;\n    accessToken: string;\n    command: VehicleCommandInput;\n  }): Promise<SmartcarCommandResult>'
);

// 6. Add new adapter methods before verifyWebhookSignature
const adapterMethods = `
  async fetchStatus(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    lastKnown?: UnifiedTelemetryData | null;
  }): Promise<UnifiedTelemetryData> {
    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: {
        vehicleId: input.vehicleId,
        provider: 'SMARTCAR',
        enabled: true,
        ...(input.providerVehicleId ? { providerVehicleId: input.providerVehicleId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!source || !source.providerVehicleId || !source.credentialRef) {
      throw new NotFoundException(
        'Enabled SMARTCAR telemetry source with credentialRef is required',
      );
    }

    const session = await this.issueToken({
      credentialRef: source.credentialRef,
      sourceConfig: this.resolveSourceConfig(source),
    });

    await this.persistSmartcarAuthState(source, session);

    const snapshot = await this.fetchVehicleSnapshot({
      providerVehicleId: source.providerVehicleId,
      accessToken: session.accessToken,
    });

    return this.buildSmartcarUnifiedTelemetry(input.vehicleId, snapshot);
  }

  async sendCommand(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    command: VehicleCommandInput;
  }): Promise<{ providerCommandId: string | null }> {
    const source = await this.prisma.vehicleTelemetrySource.findFirst({
      where: {
        vehicleId: input.vehicleId,
        provider: 'SMARTCAR',
        enabled: true,
        ...(input.providerVehicleId ? { providerVehicleId: input.providerVehicleId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!source || !source.providerVehicleId || !source.credentialRef) {
      throw new NotFoundException(
        'Enabled SMARTCAR telemetry source with credentialRef is required',
      );
    }

    const session = await this.issueToken({
      credentialRef: source.credentialRef,
      sourceConfig: this.resolveSourceConfig(source),
    });

    await this.persistSmartcarAuthState(source, session);

    const result = await this.dispatchVehicleCommand({
      providerVehicleId: source.providerVehicleId,
      accessToken: session.accessToken,
      command: input.command,
    });

    return { providerCommandId: result.providerCommandId };
  }

  verifyWebhook(input: { rawBody: string; signature: string; secretRef: string }): boolean {
    return this.verifyWebhookSignature(input.rawBody, input.signature);
  }

  ingestWebhook(payload: Record<string, unknown>): UnifiedTelemetryData {
    const eventData = asRecord(payload.data);
    const vehicleId =
      stringOrNull(payload.vehicleId) ||
      stringOrNull(asRecord(eventData.vehicle).id) ||
      stringOrNull(payload.providerVehicleId) ||
      '';
    const providerVehicleId = stringOrNull(payload.providerVehicleId) || vehicleId;
    const lastSyncedAt = this.extractWebhookTimestamp(payload);
    const snapshot = this.buildSmartcarUnifiedTelemetry(vehicleId, {
      providerVehicleId,
      batterySoc:
        numberOrNull(asRecord(payload.battery).soc) ??
        numberOrNull(asRecord(eventData.battery).percentRemaining),
      rangeKm:
        numberOrNull(asRecord(payload.battery).estimatedRangeKm) ??
        numberOrNull(asRecord(eventData.battery).range),
      isPluggedIn:
        boolOrNull(asRecord(payload.charging).isPluggedIn) ??
        boolOrNull(asRecord(asRecord(eventData.charge).isPluggedIn)),
      chargeState:
        stringOrNull(asRecord(payload.charging).status) ??
        stringOrNull(asRecord(eventData.charge).state),
      chargeLimitPercent:
        numberOrNull(asRecord(payload.charging).chargeLimitPercent) ??
        (numberOrNull(asRecord(eventData.chargeLimit).limit) !== null
          ? Number((Number(asRecord(eventData.chargeLimit).limit) * 100).toFixed(2))
          : null),
      odometerKm:
        numberOrNull(asRecord(payload.odometer).totalKm) ??
        numberOrNull(asRecord(eventData.odometer).distance),
      latitude:
        numberOrNull(asRecord(payload.gps).latitude) ??
        numberOrNull(asRecord(eventData.location).latitude),
      longitude:
        numberOrNull(asRecord(payload.gps).longitude) ??
        numberOrNull(asRecord(eventData.location).longitude),
      isLocked:
        boolOrNull(asRecord(payload.security).isLocked) ??
        boolOrNull(asRecord(eventData.security).isLocked),
    });

    return {
      ...snapshot,
      vehicleId,
      providerId: providerVehicleId,
      lastSyncedAt,
    };
  }

`;

content = content.replace('  verifyWebhookSignature', adapterMethods + '  verifyWebhookSignature');

// 7. Add private helpers at the end before the closing brace
const helpers = `

  private resolveSourceConfig(source: {
    credentialRef: string | null;
    metadata: unknown;
  }): Record<string, unknown> {
    const metadataAuth = asRecord(asRecord(source.metadata).smartcarAuth);
    const credentialRef =
      source.credentialRef || stringOrNull(metadataAuth.credentialRef);
    const cachedSecrets = credentialRef
      ? this.authTokenCache.get(credentialRef)
      : undefined;

    if (!cachedSecrets) {
      return metadataAuth;
    }

    return {
      ...metadataAuth,
      accessToken: cachedSecrets.accessToken,
      refreshToken: cachedSecrets.refreshToken,
      accessTokenExpiresAt: cachedSecrets.expiresAt,
    };
  }

  private async persistSmartcarAuthState(
    source: { id: string; metadata: unknown },
    session: SmartcarTokenSession,
  ): Promise<void> {
    const metadata = asRecord(source.meta
