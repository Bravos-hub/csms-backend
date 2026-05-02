import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { VehicleCommandInput } from './telemetry.types';

type SmartcarTokenSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  credentialRef: string;
};

type SmartcarCredentialConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  authorizationCode: string | null;
  refreshToken: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
};

type SmartcarStatusSnapshot = {
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
};

type SmartcarCommandResult = {
  providerCommandId: string;
};

type SmartcarHttpResponse = {
  status: number;
  body: unknown;
};

type SmartcarTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
};

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

function normalizeBaseUrl(url: string | null, fallback: string): string {
  if (!url || !url.trim()) return fallback;
  return url.trim().replace(/\/+$/, '');
}

function parseTokenResponse(
  payload: unknown,
  credentialRef: string,
): SmartcarTokenSession {
  const row = asRecord(payload) as SmartcarTokenResponse;
  const accessToken = stringOrNull(row.access_token);
  if (!accessToken) {
    throw new UnauthorizedException('Smartcar token response missing access_token');
  }

  const refreshToken = stringOrNull(row.refresh_token);
  const expiresInRaw = row.expires_in;
  const expiresIn =
    typeof expiresInRaw === 'number' && Number.isFinite(expiresInRaw)
      ? Math.max(0, Math.floor(expiresInRaw))
      : null;
  const expiresAt =
    expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    accessToken,
    refreshToken,
    expiresAt,
    credentialRef,
  };
}

function parseCredentials(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return asRecord(raw);
}

function parseCredentialConfig(
  credentialRef: string,
  sourceConfig: unknown,
  config: ConfigService<Record<string, unknown>>,
): SmartcarCredentialConfig {
  const allCredentialConfigs = parseCredentials(
    config.get<string>('TELEMETRY_CREDENTIALS_JSON'),
  );
  const byRef = asRecord(allCredentialConfigs[credentialRef]);
  const source = asRecord(sourceConfig);

  const clientId =
    stringOrNull(byRef.clientId) || config.get<string>('SMARTCAR_CLIENT_ID') || '';
  const clientSecret =
    stringOrNull(byRef.clientSecret) ||
    config.get<string>('SMARTCAR_CLIENT_SECRET') ||
    '';

  if (!clientId || !clientSecret) {
    throw new UnauthorizedException(
      `Smartcar credentials not configured for credentialRef ${credentialRef}`,
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri:
      stringOrNull(byRef.redirectUri) ||
      config.get<string>('SMARTCAR_REDIRECT_URI') ||
      null,
    authorizationCode:
      stringOrNull(source.authorizationCode) ||
      stringOrNull(byRef.authorizationCode) ||
      null,
    refreshToken:
      stringOrNull(source.refreshToken) || stringOrNull(byRef.refreshToken) || null,
    accessToken:
      stringOrNull(source.accessToken) || stringOrNull(byRef.accessToken) || null,
    accessTokenExpiresAt:
      stringOrNull(source.accessTokenExpiresAt) ||
      stringOrNull(byRef.accessTokenExpiresAt) ||
      null,
  };
}

@Injectable()
export class SmartcarProviderService {
  constructor(
    private readonly config: ConfigService<Record<string, unknown>>,
  ) {}

  async issueToken(input: {
    credentialRef: string;
    sourceConfig?: unknown;
  }): Promise<SmartcarTokenSession> {
    const creds = parseCredentialConfig(
      input.credentialRef,
      input.sourceConfig,
      this.config,
    );

    if (creds.accessToken && creds.accessTokenExpiresAt) {
      const expiresAtMs = Date.parse(creds.accessTokenExpiresAt);
      const skewMs = this.getPositiveInt('SMARTCAR_TOKEN_REFRESH_SKEW_MS', 30_000);
      if (!Number.isNaN(expiresAtMs) && expiresAtMs - skewMs > Date.now()) {
        return {
          accessToken: creds.accessToken,
          refreshToken: creds.refreshToken,
          expiresAt: creds.accessTokenExpiresAt,
          credentialRef: input.credentialRef,
        };
      }
    }

    if (creds.refreshToken) {
      return this.refreshToken({
        credentialRef: input.credentialRef,
        refreshToken: creds.refreshToken,
        sourceConfig: input.sourceConfig,
      });
    }

    if (!creds.authorizationCode || !creds.redirectUri) {
      throw new BadRequestException(
        'Smartcar token issuance requires authorizationCode and redirectUri',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: creds.authorizationCode,
      redirect_uri: creds.redirectUri,
    });

    const result = await this.callTokenEndpoint(body, creds.clientId, creds.clientSecret);
    return parseTokenResponse(result.body, input.credentialRef);
  }

  async refreshToken(input: {
    credentialRef: string;
    refreshToken: string;
    sourceConfig?: unknown;
  }): Promise<SmartcarTokenSession> {
    const creds = parseCredentialConfig(
      input.credentialRef,
      input.sourceConfig,
      this.config,
    );

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    });
    const result = await this.callTokenEndpoint(body, creds.clientId, creds.clientSecret);
    return parseTokenResponse(result.body, input.credentialRef);
  }

  async fetchStatus(input: {
    providerVehicleId: string;
    accessToken: string;
  }): Promise<SmartcarStatusSnapshot> {
    const vehicleId = input.providerVehicleId;

    const [battery, charge, chargeLimit, odometer, location, security] =
      await Promise.all([
        this.readVehicleEndpoint(vehicleId, '/battery', input.accessToken),
        this.readVehicleEndpoint(vehicleId, '/charge', input.accessToken),
        this.readVehicleEndpoint(vehicleId, '/charge/limit', input.accessToken),
        this.readVehicleEndpoint(vehicleId, '/odometer', input.accessToken),
        this.readVehicleEndpoint(vehicleId, '/location', input.accessToken),
        this.readVehicleEndpoint(vehicleId, '/security', input.accessToken),
      ]);

    const batteryRec = asRecord(battery.body);
    const chargeRec = asRecord(charge.body);
    const chargeLimitRec = asRecord(chargeLimit.body);
    const odometerRec = asRecord(odometer.body);
    const locationRec = asRecord(location.body);
    const securityRec = asRecord(security.body);

    const percentRemaining = numberOrNull(batteryRec.percentRemaining);
    const chargeLimitFraction = numberOrNull(chargeLimitRec.limit);

    return {
      providerVehicleId: vehicleId,
      batterySoc:
        percentRemaining === null ? null : Number((percentRemaining * 100).toFixed(2)),
      rangeKm: numberOrNull(batteryRec.range),
      isPluggedIn: boolOrNull(chargeRec.isPluggedIn),
      chargeState: stringOrNull(chargeRec.state),
      chargeLimitPercent:
        chargeLimitFraction === null
          ? null
          : Number((chargeLimitFraction * 100).toFixed(2)),
      odometerKm: numberOrNull(odometerRec.distance),
      latitude: numberOrNull(locationRec.latitude),
      longitude: numberOrNull(locationRec.longitude),
      isLocked: boolOrNull(securityRec.isLocked),
    };
  }

  async sendCommand(input: {
    providerVehicleId: string;
    accessToken: string;
    command: VehicleCommandInput;
  }): Promise<SmartcarCommandResult> {
    const vehicleId = input.providerVehicleId;
    const providerCommandId = `smartcar_${Date.now().toString(36)}`;

    if (input.command.type === 'LOCK' || input.command.type === 'UNLOCK') {
      await this.writeVehicleEndpoint(
        vehicleId,
        '/security',
        { action: input.command.type },
        input.accessToken,
      );
      return { providerCommandId };
    }

    if (
      input.command.type === 'START_CHARGING' ||
      input.command.type === 'STOP_CHARGING'
    ) {
      await this.writeVehicleEndpoint(
        vehicleId,
        '/charge',
        { action: input.command.type === 'START_CHARGING' ? 'START' : 'STOP' },
        input.accessToken,
      );
      return { providerCommandId };
    }

    if (input.command.type === 'SET_CHARGE_LIMIT') {
      const boundedLimit = Math.min(100, Math.max(50, input.command.limitPercent));
      await this.writeVehicleEndpoint(
        vehicleId,
        '/charge/limit',
        { limit: Number((boundedLimit / 100).toFixed(2)) },
        input.accessToken,
      );
      return { providerCommandId };
    }

    throw new BadRequestException(
      `Smartcar does not support ${input.command.type} command`,
    );
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    const managementToken = this.config.get<string>('SMARTCAR_MANAGEMENT_TOKEN');
    if (!managementToken) {
      return true;
    }

    if (!signature) return false;

    const computed = createHmac('sha256', managementToken)
      .update(rawBody)
      .digest('hex');

    const actual = signature.trim();
    if (actual.length !== computed.length) {
      return false;
    }

    return timingSafeEqual(Buffer.from(computed), Buffer.from(actual));
  }

  buildVerifyChallengeResponse(challenge: string): { challenge: string } {
    const managementToken = this.config.get<string>('SMARTCAR_MANAGEMENT_TOKEN');
    if (!managementToken) {
      throw new UnauthorizedException('SMARTCAR_MANAGEMENT_TOKEN is not configured');
    }

    return {
      challenge: createHmac('sha256', managementToken)
        .update(challenge)
        .digest('hex'),
    };
  }

  private getPositiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.floor(parsed);
    return rounded > 0 ? rounded : fallback;
  }

  private async callTokenEndpoint(
    payload: URLSearchParams,
    clientId: string,
    clientSecret: string,
  ): Promise<SmartcarHttpResponse> {
    const baseUrl = normalizeBaseUrl(
      this.config.get<string>('SMARTCAR_AUTH_BASE_URL') || null,
      'https://auth.smartcar.com',
    );
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const url = `${baseUrl}/oauth/token`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
      signal: AbortSignal.timeout(this.getPositiveInt('SMARTCAR_HTTP_TIMEOUT_MS', 20_000)),
    });

    const body = await this.readResponseBody(response);
    if (!response.ok) {
      const err = stringOrNull(asRecord(body).error_description) || response.statusText;
      throw new UnauthorizedException(
        `Smartcar token request failed (${response.status}): ${err}`,
      );
    }

    return { status: response.status, body };
  }

  private async readVehicleEndpoint(
    providerVehicleId: string,
    path: string,
    accessToken: string,
  ): Promise<SmartcarHttpResponse> {
    const url = `${this.readVehicleApiBaseUrl()}/vehicles/${providerVehicleId}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(this.getPositiveInt('SMARTCAR_HTTP_TIMEOUT_MS', 20_000)),
    });

    const body = await this.readResponseBody(response);
    if (!response.ok) {
      const code = stringOrNull(asRecord(body).code) || 'SMARTCAR_REQUEST_FAILED';
      const message = stringOrNull(asRecord(body).description) || response.statusText;
      throw new BadRequestException(
        `Smartcar request failed (${response.status}) ${code}: ${message}`,
      );
    }

    return { status: response.status, body };
  }

  private async writeVehicleEndpoint(
    providerVehicleId: string,
    path: string,
    payload: Record<string, unknown>,
    accessToken: string,
  ): Promise<SmartcarHttpResponse> {
    const url = `${this.readVehicleApiBaseUrl()}/vehicles/${providerVehicleId}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.getPositiveInt('SMARTCAR_HTTP_TIMEOUT_MS', 20_000)),
    });

    const body = await this.readResponseBody(response);
    if (!response.ok) {
      const code = stringOrNull(asRecord(body).code) || 'SMARTCAR_COMMAND_FAILED';
      const message = stringOrNull(asRecord(body).description) || response.statusText;
      throw new BadRequestException(
        `Smartcar command failed (${response.status}) ${code}: ${message}`,
      );
    }

    return { status: response.status, body };
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }

  private readVehicleApiBaseUrl(): string {
    return normalizeBaseUrl(
      this.config.get<string>('SMARTCAR_VEHICLE_API_BASE_URL') || null,
      'https://api.smartcar.com/v2.0',
    );
  }
}
