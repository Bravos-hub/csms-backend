import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { HealthCheckService } from './health-check.service';
import { PaymentProviderHealthService } from '../payments/payment-provider-health.service';

describe('HealthCheckService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function createService(configValues: Record<string, string | undefined>) {
    const prisma = {
      $queryRaw: jest.fn(),
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    const paymentProviderHealth = {
      checkGatewayHealth: jest.fn(),
    } as unknown as PaymentProviderHealthService;
    return new HealthCheckService(prisma, config, paymentProviderHealth);
  }

  it('marks payment gateway degraded when health URL is missing', async () => {
    const service = createService({});
    const result = await (
      service as unknown as {
        checkPaymentGateway: () => Promise<{
          status: string;
          metadata?: Record<string, unknown>;
        }>;
      }
    ).checkPaymentGateway();

    expect(result.status).toBe('Degraded');
    expect(result.metadata?.error).toBeDefined();
  });

  it('calls configured payment health endpoint with bearer auth', async () => {
    const service = createService({
      PAYMENT_HEALTHCHECK_URL: 'https://payments.example.com/health',
      PAYMENT_HEALTHCHECK_BEARER_TOKEN: 'token-123',
      PAYMENT_HEALTHCHECK_TIMEOUT_MS: '5000',
    });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await (
      service as unknown as {
        checkPaymentGateway: () => Promise<{
          status: string;
          metadata?: Record<string, unknown>;
        }>;
      }
    ).checkPaymentGateway();

    expect(result.status).toBe('Operational');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, requestOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://payments.example.com/health');
    expect(requestOptions?.method).toBe('GET');
    expect(requestOptions?.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer token-123',
      }),
    );
  });

  it('uses provider health service when payment orchestration is enabled', async () => {
    const checkGatewayHealth = jest.fn().mockResolvedValue({
      status: 'Degraded',
      responseTime: 123,
      metadata: {
        configuredProviders: 4,
        healthyConfiguredProviders: 3,
      },
    });
    const prisma = {
      $queryRaw: jest.fn(),
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) =>
        key === 'PAYMENT_ORCHESTRATION_ENABLED' ? 'true' : undefined,
      ),
    } as unknown as ConfigService;
    const paymentProviderHealth = {
      checkGatewayHealth,
    } as unknown as PaymentProviderHealthService;

    const service = new HealthCheckService(
      prisma,
      config,
      paymentProviderHealth,
    );
    const result = await (
      service as unknown as {
        checkPaymentGateway: () => Promise<{
          status: string;
          responseTime: number;
          metadata?: Record<string, unknown>;
        }>;
      }
    ).checkPaymentGateway();

    expect(checkGatewayHealth).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('Degraded');
    expect(result.responseTime).toBe(123);
  });
});
