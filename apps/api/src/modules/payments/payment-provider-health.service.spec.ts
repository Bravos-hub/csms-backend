import { PaymentProviderAdapterService } from './payment-provider-adapter.service';
import { PaymentProviderHealthService } from './payment-provider-health.service';

describe('PaymentProviderHealthService', () => {
  const adapters = {
    isConfigured: jest.fn(),
    probe: jest.fn(),
  };

  const service = new PaymentProviderHealthService(
    adapters as unknown as PaymentProviderAdapterService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns Operational when all configured providers are healthy', async () => {
    adapters.isConfigured.mockReturnValue(true);
    adapters.probe.mockResolvedValue({
      healthy: true,
      responseTime: 10,
      statusCode: 200,
    });

    const result = await service.checkGatewayHealth();

    expect(result.status).toBe('Operational');
    expect(result.metadata.marketCoverage.china).toBe(true);
    expect(result.metadata.marketCoverage.global).toBe(true);
  });

  it('returns Down when no providers are configured', async () => {
    adapters.isConfigured.mockReturnValue(false);

    const result = await service.checkGatewayHealth();

    expect(result.status).toBe('Down');
    expect(result.metadata.configuredProviders).toBe(0);
  });

  it('returns Degraded when one configured provider is unhealthy but market coverage remains', async () => {
    adapters.isConfigured.mockReturnValue(true);
    adapters.probe.mockImplementation((provider: string) => {
      if (provider === 'STRIPE') {
        return Promise.resolve({ healthy: false, responseTime: 120 });
      }
      return Promise.resolve({
        healthy: true,
        responseTime: 20,
        statusCode: 200,
      });
    });

    const result = await service.checkGatewayHealth();

    expect(result.status).toBe('Degraded');
    expect(result.metadata.marketCoverage.china).toBe(true);
    expect(result.metadata.marketCoverage.global).toBe(true);
  });
});
