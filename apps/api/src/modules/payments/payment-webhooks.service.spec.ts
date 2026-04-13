import { PrismaService } from '../../prisma.service';
import { PaymentProviderAdapterService } from './payment-provider-adapter.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentWebhooksService } from './payment-webhooks.service';

describe('PaymentWebhooksService', () => {
  const prisma = {
    paymentWebhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const adapters = {
    verifyWebhookSignature: jest.fn(),
  };

  const settlement = {
    resolveIntent: jest.fn(),
    applyFinalStatus: jest.fn(),
  };

  const service = new PaymentWebhooksService(
    prisma as unknown as PrismaService,
    adapters as unknown as PaymentProviderAdapterService,
    settlement as unknown as PaymentSettlementService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('processes valid stripe webhooks and marks event processed', async () => {
    adapters.verifyWebhookSignature.mockReturnValue(true);
    prisma.paymentWebhookEvent.findUnique.mockResolvedValue(null);
    prisma.paymentWebhookEvent.create.mockResolvedValue({ id: 'evt-db-1' });
    settlement.resolveIntent.mockResolvedValue({ id: 'pi_1' });
    settlement.applyFinalStatus.mockResolvedValue({ id: 'pi_1' });
    prisma.paymentWebhookEvent.update.mockResolvedValue({ id: 'evt-db-1' });

    const payload = {
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          payment_intent: 'pi_external_1',
          client_reference_id: 'idem_1',
          amount_total: 2500,
          currency: 'usd',
        },
      },
    };

    const result = await service.handleWebhook({
      provider: 'STRIPE',
      rawBody: JSON.stringify(payload),
      payload,
      headers: {
        'stripe-signature': 'valid',
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.status).toBe('PROCESSED');
    expect(settlement.applyFinalStatus).toHaveBeenCalledTimes(1);
  });

  it('rejects webhooks with invalid signatures', async () => {
    adapters.verifyWebhookSignature.mockReturnValue(false);

    await expect(
      service.handleWebhook({
        provider: 'FLUTTERWAVE',
        rawBody: '{}',
        payload: {},
        headers: {},
      }),
    ).rejects.toThrow('Webhook signature verification failed');

    expect(prisma.paymentWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('returns duplicate result when webhook event already exists', async () => {
    adapters.verifyWebhookSignature.mockReturnValue(true);
    prisma.paymentWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt-existing',
      status: 'PROCESSED',
      paymentIntentId: 'pi_existing',
    });

    const payload = {
      id: 'evt_existing',
      type: 'checkout.session.completed',
      data: { object: {} },
    };

    const result = await service.handleWebhook({
      provider: 'STRIPE',
      rawBody: JSON.stringify(payload),
      payload,
      headers: {
        'stripe-signature': 'valid',
      },
    });

    expect(result.duplicate).toBe(true);
    expect(result.intentId).toBe('pi_existing');
    expect(prisma.paymentWebhookEvent.create).not.toHaveBeenCalled();
  });
});
