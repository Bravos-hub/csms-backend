import { generateKeyPairSync, createHmac, createSign } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaymentProviderAdapterService } from './payment-provider-adapter.service';

describe('PaymentProviderAdapterService', () => {
  const originalFetch = global.fetch;

  const rsaPair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { format: 'pem', type: 'spki' },
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  });

  function createService(configValues: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    return new PaymentProviderAdapterService(config);
  }

  function mockFetchJsonOnce(
    payload: Record<string, unknown>,
    ok = true,
    status = 200,
  ): jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>> {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok,
        status,
        text: () => Promise.resolve(JSON.stringify(payload)),
      } as unknown as Response);

    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function readHeader(
    headers: HeadersInit | undefined,
    key: string,
  ): string | undefined {
    if (!headers) {
      return undefined;
    }

    if (headers instanceof Headers) {
      return headers.get(key) ?? undefined;
    }

    const lowered = key.toLowerCase();
    if (Array.isArray(headers)) {
      const match = headers.find(
        ([headerKey]) => headerKey.toLowerCase() === lowered,
      );
      return match?.[1];
    }

    for (const [headerKey, headerValue] of Object.entries(headers)) {
      if (headerKey.toLowerCase() === lowered) {
        return Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
      }
    }

    return undefined;
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('creates Stripe payment sessions', async () => {
    const service = createService({
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_SUCCESS_URL: 'https://portal.example.com/success',
      STRIPE_CANCEL_URL: 'https://portal.example.com/cancel',
      PAYMENT_PROVIDER_TIMEOUT_MS: '5000',
    });

    const fetchMock = mockFetchJsonOnce({
      id: 'cs_123',
      url: 'https://checkout.stripe.com/c/cs_123',
    });

    const result = await service.createPayment({
      provider: 'STRIPE',
      market: 'GLOBAL',
      amount: 15,
      currency: 'USD',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
      metadata: {},
    });

    expect(result.provider).toBe('STRIPE');
    expect(result.providerPaymentId).toBe('cs_123');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/cs_123');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/checkout/sessions'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates Flutterwave payments', async () => {
    const service = createService({
      FLUTTERWAVE_SECRET_KEY: 'flw_sk',
      FLUTTERWAVE_REDIRECT_URL: 'https://portal.example.com/flw',
      PAYMENT_PROVIDER_TIMEOUT_MS: '5000',
    });

    mockFetchJsonOnce({
      status: 'success',
      data: {
        id: 'trx_1',
        flw_ref: 'flw-ref-1',
        link: 'https://flutterwave.test/pay/1',
      },
    });

    const result = await service.createPayment({
      provider: 'FLUTTERWAVE',
      market: 'GLOBAL',
      amount: 20,
      currency: 'USD',
      idempotencyKey: 'idem-2',
      correlationId: 'corr-2',
      metadata: {},
    });

    expect(result.provider).toBe('FLUTTERWAVE');
    expect(result.providerPaymentId).toBe('trx_1');
    expect(result.checkoutUrl).toBe('https://flutterwave.test/pay/1');
  });

  it('creates Alipay payments with RSA signature', async () => {
    const service = createService({
      ALIPAY_CLIENT_ID: 'ali_client_1',
      ALIPAY_PRIVATE_KEY: rsaPair.privateKey,
      ALIPAY_PUBLIC_KEY: rsaPair.publicKey,
      PAYMENT_PROVIDER_TIMEOUT_MS: '5000',
    });

    const fetchMock = mockFetchJsonOnce({
      paymentId: 'ali_pay_1',
      orderCodeForm: {
        codeDetails: [{ codeValue: 'https://alipay.test/pay/1' }],
      },
    });

    const result = await service.createPayment({
      provider: 'ALIPAY',
      market: 'CHINA',
      amount: 30,
      currency: 'CNY',
      idempotencyKey: 'idem-3',
      correlationId: 'corr-3',
      metadata: {},
    });

    expect(result.provider).toBe('ALIPAY');
    expect(result.providerPaymentId).toBe('ali_pay_1');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(readHeader(init?.headers, 'client-id')).toBe('ali_client_1');
    expect(readHeader(init?.headers, 'signature')).toContain('signature=');
  });

  it('creates LianLian payments with RSA signature', async () => {
    const service = createService({
      LIANLIAN_MERCHANT_ID: 'mch_1',
      LIANLIAN_SUB_MERCHANT_ID: 'sub_1',
      LIANLIAN_PRIVATE_KEY: rsaPair.privateKey,
      LIANLIAN_PUBLIC_KEY: rsaPair.publicKey,
      PAYMENT_PROVIDER_TIMEOUT_MS: '5000',
    });

    const fetchMock = mockFetchJsonOnce({
      ll_transaction_id: 'll_txn_1',
      payment_url: 'https://lianlian.test/pay/1',
    });

    const result = await service.createPayment({
      provider: 'LIANLIAN',
      market: 'CHINA',
      amount: 40,
      currency: 'CNY',
      idempotencyKey: 'idem-4',
      correlationId: 'corr-4',
      metadata: {},
    });

    expect(result.provider).toBe('LIANLIAN');
    expect(result.providerPaymentId).toBe('ll_txn_1');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const signature = readHeader(init?.headers, 'signature');
    expect(signature).toBeDefined();
    expect(signature && signature.length > 0).toBe(true);
  });

  it('runs authenticated probes for configured providers', async () => {
    const service = createService({
      STRIPE_SECRET_KEY: 'sk_test',
      FLUTTERWAVE_SECRET_KEY: 'flw_secret',
      ALIPAY_CLIENT_ID: 'ali_client',
      ALIPAY_PRIVATE_KEY: rsaPair.privateKey,
      LIANLIAN_MERCHANT_ID: 'mch_1',
      LIANLIAN_SUB_MERCHANT_ID: 'sub_1',
      LIANLIAN_PRIVATE_KEY: rsaPair.privateKey,
      PAYMENT_PROVIDER_TIMEOUT_MS: '5000',
    });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('{"status":"not_found"}'),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const stripeProbe = await service.probe('STRIPE');
    const flutterwaveProbe = await service.probe('FLUTTERWAVE');
    const alipayProbe = await service.probe('ALIPAY');
    const lianlianProbe = await service.probe('LIANLIAN');

    expect(stripeProbe.healthy).toBe(true);
    expect(flutterwaveProbe.healthy).toBe(true);
    expect(alipayProbe.healthy).toBe(true);
    expect(lianlianProbe.healthy).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('verifies webhook signatures for all providers', () => {
    const service = createService({
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      FLUTTERWAVE_WEBHOOK_SECRET_HASH: 'flw_hash_secret',
      ALIPAY_PUBLIC_KEY: rsaPair.publicKey,
      LIANLIAN_PUBLIC_KEY: rsaPair.publicKey,
    });

    const rawBody = JSON.stringify({ hello: 'world' });

    const stripeTimestamp = String(Math.floor(Date.now() / 1000));
    const stripeSig = createHmac('sha256', 'whsec_123')
      .update(`${stripeTimestamp}.${rawBody}`)
      .digest('hex');

    const flutterwaveSig = createHmac('sha256', 'flw_hash_secret')
      .update(rawBody)
      .digest('base64');

    const signer = createSign('RSA-SHA256');
    signer.update(rawBody);
    signer.end();
    const rsaSignature = signer.sign(rsaPair.privateKey, 'base64');

    expect(
      service.verifyWebhookSignature({
        provider: 'STRIPE',
        rawBody,
        headers: {
          'stripe-signature': `t=${stripeTimestamp},v1=${stripeSig}`,
        },
      }),
    ).toBe(true);

    expect(
      service.verifyWebhookSignature({
        provider: 'FLUTTERWAVE',
        rawBody,
        headers: {
          'flutterwave-signature': flutterwaveSig,
        },
      }),
    ).toBe(true);

    expect(
      service.verifyWebhookSignature({
        provider: 'ALIPAY',
        rawBody,
        headers: {
          signature: `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(rsaSignature)}`,
        },
      }),
    ).toBe(true);

    expect(
      service.verifyWebhookSignature({
        provider: 'LIANLIAN',
        rawBody,
        headers: {
          signature: rsaSignature,
        },
      }),
    ).toBe(true);
  });
});
