import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { SmartcarProviderService } from './smartcar-provider.service';

describe('SmartcarProviderService', () => {
  const config = {
    get: jest.fn(),
  };

  const service = new SmartcarProviderService(
    config as unknown as ConfigService<Record<string, unknown>>,
  );

  const originalFetch = global.fetch;

  function jsonResponse(
    payload: Record<string, unknown>,
    status = 200,
  ): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  beforeEach(() => {
    config.get.mockReset();
    config.get.mockImplementation((key: string) => {
      if (key === 'SMARTCAR_CLIENT_ID') {
        return 'default-client-id';
      }
      if (key === 'SMARTCAR_CLIENT_SECRET') {
        return 'default-client-secret';
      }
      return undefined;
    });
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('reuses a valid cached token from source metadata', async () => {
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    const session = await service.issueToken({
      credentialRef: 'cred:tenant:smartcar',
      sourceConfig: {
        accessToken: 'cached-access',
        refreshToken: 'cached-refresh',
        accessTokenExpiresAt: expiresAt,
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(session).toEqual({
      accessToken: 'cached-access',
      refreshToken: 'cached-refresh',
      expiresAt,
      credentialRef: 'cred:tenant:smartcar',
    });
  });

  it('refreshes token against smartcar auth endpoint', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'TELEMETRY_CREDENTIALS_JSON') {
        return JSON.stringify({
          'cred:tenant:smartcar': {
            clientId: 'client-1',
            clientSecret: 'secret-1',
          },
        });
      }
      return undefined;
    });
    (global.fetch as unknown as jest.Mock).mockResolvedValue(
      jsonResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    );

    const session = await service.refreshToken({
      credentialRef: 'cred:tenant:smartcar',
      refreshToken: 'old-refresh',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://auth.smartcar.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic '),
        }),
      }),
    );
    expect(session.accessToken).toBe('new-access');
    expect(session.refreshToken).toBe('new-refresh');
    expect(session.credentialRef).toBe('cred:tenant:smartcar');
    expect(session.expiresAt).toBeTruthy();
  });

  it('fetches and maps vehicle status from smartcar APIs', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'SMARTCAR_VEHICLE_API_BASE_URL') {
        return 'https://api.smartcar.com/v2.0';
      }
      return undefined;
    });

    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/battery')) {
        return Promise.resolve(
          jsonResponse({ percentRemaining: 0.67, range: 245.2 }),
        );
      }
      if (url.endsWith('/charge')) {
        return Promise.resolve(
          jsonResponse({ isPluggedIn: true, state: 'CHARGING' }),
        );
      }
      if (url.endsWith('/charge/limit')) {
        return Promise.resolve(jsonResponse({ limit: 0.9 }));
      }
      if (url.endsWith('/odometer')) {
        return Promise.resolve(jsonResponse({ distance: 18234.4 }));
      }
      if (url.endsWith('/location')) {
        return Promise.resolve(jsonResponse({ latitude: 0.31, longitude: 32.58 }));
      }
      if (url.endsWith('/security')) {
        return Promise.resolve(jsonResponse({ isLocked: false }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const status = await service.fetchStatus({
      providerVehicleId: 'smartcar-veh-1',
      accessToken: 'access-1',
    });

    expect(status).toEqual({
      providerVehicleId: 'smartcar-veh-1',
      batterySoc: 67,
      rangeKm: 245.2,
      isPluggedIn: true,
      chargeState: 'CHARGING',
      chargeLimitPercent: 90,
      odometerKm: 18234.4,
      latitude: 0.31,
      longitude: 32.58,
      isLocked: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('dispatches supported commands and bounds charge limit', async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock.mockResolvedValue(jsonResponse({}));

    const result = await service.sendCommand({
      providerVehicleId: 'smartcar-veh-1',
      accessToken: 'access-1',
      command: {
        type: 'SET_CHARGE_LIMIT',
        limitPercent: 10,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.smartcar.com/v2.0/vehicles/smartcar-veh-1/charge/limit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ limit: 0.5 }),
      }),
    );
    expect(result.providerCommandId).toEqual(expect.stringMatching(/^smartcar_/));
  });

  it('uses provider command id from smartcar response when available', async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock.mockResolvedValue(jsonResponse({ id: 'provider-command-1' }));

    const result = await service.sendCommand({
      providerVehicleId: 'smartcar-veh-1',
      accessToken: 'access-1',
      command: {
        type: 'LOCK',
      },
    });

    expect(result.providerCommandId).toBe('provider-command-1');
  });

  it('verifies webhook signatures using management token', () => {
    config.get.mockImplementation((key: string) =>
      key === 'SMARTCAR_MANAGEMENT_TOKEN' ? 'secret-token' : undefined,
    );
    const body = '{"eventType":"VERIFY"}';
    const signature = createHmac('sha256', 'secret-token')
      .update(body)
      .digest('hex');

    expect(service.verifyWebhookSignature(body, signature)).toBe(true);
    expect(service.verifyWebhookSignature(body, 'mismatch')).toBe(false);
  });

  it('fails closed when management token is not configured', () => {
    const body = '{"eventType":"VERIFY"}';

    expect(() => service.verifyWebhookSignature(body, 'sig')).toThrow(
      UnauthorizedException,
    );
    expect(() => service.verifyWebhookSignature(body, 'sig')).toThrow(
      'SMARTCAR_MANAGEMENT_TOKEN is required for webhook verification',
    );
  });
});
