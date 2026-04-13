import { PaymentMarketResolverService } from './payment-market-resolver.service';
import { PaymentOrchestrationService } from './payment-orchestration.service';
import { PaymentProviderAdapterService } from './payment-provider-adapter.service';

describe('PaymentOrchestrationService', () => {
  const resolver = {
    resolveForUser: jest.fn(),
    resolveForGuest: jest.fn(),
  };

  const adapters = {
    isConfigured: jest.fn(),
    createPayment: jest.fn(),
  };

  const service = new PaymentOrchestrationService(
    resolver as unknown as PaymentMarketResolverService,
    adapters as unknown as PaymentProviderAdapterService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to secondary provider when primary fails', async () => {
    resolver.resolveForUser.mockResolvedValue({
      market: 'GLOBAL',
      zoneId: null,
      country: 'US',
      region: null,
      reason: 'user_profile:country',
    });

    adapters.isConfigured.mockReturnValue(true);
    adapters.createPayment
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce({
        provider: 'FLUTTERWAVE',
        market: 'GLOBAL',
        providerPaymentId: 'flw-1',
        checkoutUrl: 'https://checkout.flutterwave.com/x',
        checkoutQrPayload: 'https://checkout.flutterwave.com/x',
        providerReference: 'flw-1',
      });

    const result = await service.createPayment({
      userId: 'user-1',
      amount: 50,
      currency: 'USD',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
      metadata: {},
    });

    expect(result.provider).toBe('FLUTTERWAVE');
    expect(result.market).toBe('GLOBAL');
    expect(result.attempts).toEqual([
      expect.objectContaining({ provider: 'STRIPE', ok: false }),
      expect.objectContaining({ provider: 'FLUTTERWAVE', ok: true }),
    ]);
  });

  it('uses china chain and skips unconfigured providers', async () => {
    resolver.resolveForGuest.mockResolvedValue({
      market: 'CHINA',
      zoneId: null,
      country: 'CN',
      region: null,
      reason: 'guest_payload:country',
    });

    adapters.isConfigured.mockImplementation((provider: string) => {
      return provider === 'ALIPAY';
    });
    adapters.createPayment.mockResolvedValue({
      provider: 'ALIPAY',
      market: 'CHINA',
      providerPaymentId: 'ali-1',
      checkoutUrl: 'https://alipay.test/checkout',
      checkoutQrPayload: 'https://alipay.test/checkout',
      providerReference: 'ali-1',
    });

    const result = await service.createPayment({
      amount: 8,
      currency: 'CNY',
      idempotencyKey: 'idem-cn',
      correlationId: 'corr-cn',
      metadata: {},
      guestGeo: { country: 'CN' },
    });

    expect(result.provider).toBe('ALIPAY');
    expect(result.attempts[0]).toEqual(
      expect.objectContaining({
        provider: 'LIANLIAN',
        ok: false,
        skipped: true,
      }),
    );
  });

  it('throws when no provider succeeds', async () => {
    resolver.resolveForGuest.mockResolvedValue({
      market: 'GLOBAL',
      zoneId: null,
      country: null,
      region: null,
      reason: 'guest_payload:default_global',
    });

    adapters.isConfigured.mockReturnValue(true);
    adapters.createPayment
      .mockRejectedValueOnce(new Error('stripe fail'))
      .mockRejectedValueOnce(new Error('flutterwave fail'));

    await expect(
      service.createPayment({
        amount: 12,
        currency: 'USD',
        idempotencyKey: 'idem-fail',
        correlationId: 'corr-fail',
        metadata: {},
      }),
    ).rejects.toThrow('No provider succeeded');
  });
});
