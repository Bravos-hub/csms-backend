import { PaymentIntent } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { PaymentSettlementService } from './payment-settlement.service';

describe('PaymentSettlementService', () => {
  const tx = {
    paymentIntent: {
      update: jest.fn(),
    },
    transaction: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      update: jest.fn(),
    },
  };

  const prisma = {
    paymentIntent: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  const service = new PaymentSettlementService(
    prisma as unknown as PrismaService,
  );

  const baseIntent: PaymentIntent = {
    id: 'pi_1',
    userId: 'user_1',
    organizationId: 'org_1',
    walletId: 'wallet_1',
    paymentMethodId: null,
    invoiceId: null,
    sessionId: null,
    amount: 25,
    currency: 'USD',
    status: 'PENDING',
    provider: 'STRIPE',
    market: 'GLOBAL',
    providerPaymentId: 'external_1',
    idempotencyKey: 'idem_1',
    correlationId: 'corr_1',
    reconciliationState: 'RECONCILING',
    checkoutUrl: 'https://checkout',
    checkoutQrPayload: 'https://checkout',
    providerReference: null,
    expiresAt: null,
    settledAt: null,
    metadata: {
      flow: 'WALLET_TOPUP',
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.paymentIntent.findUnique.mockResolvedValue(baseIntent);
    tx.paymentIntent.update.mockResolvedValue({
      ...baseIntent,
      status: 'SETTLED',
      settledAt: new Date(),
      providerReference: 'provider_ref',
    });
    tx.transaction.findFirst.mockResolvedValue({
      id: 'txn_1',
      walletId: 'wallet_1',
      status: 'PENDING',
      amount: 25,
      reference: null,
    });
    tx.wallet.update.mockResolvedValue({ id: 'wallet_1' });
    tx.transaction.update.mockResolvedValue({ id: 'txn_1' });
  });

  it('credits wallet once when settling pending wallet top-up', async () => {
    const result = await service.applyFinalStatus({
      intentId: 'pi_1',
      status: 'SETTLED',
      provider: 'STRIPE',
      providerPaymentId: 'external_1',
    });

    expect(result.status).toBe('SETTLED');
    expect(tx.wallet.update).toHaveBeenCalledTimes(1);
    expect(tx.transaction.update).toHaveBeenCalledTimes(1);
  });

  it('does not credit wallet again when top-up transaction is already posted', async () => {
    tx.transaction.findFirst.mockResolvedValue({
      id: 'txn_1',
      walletId: 'wallet_1',
      status: 'POSTED',
      amount: 25,
      reference: 'TOPUP_1',
    });

    await service.applyFinalStatus({
      intentId: 'pi_1',
      status: 'SETTLED',
      provider: 'STRIPE',
      providerPaymentId: 'external_1',
    });

    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  it('marks pending top-up transaction as failed on non-settled status', async () => {
    tx.paymentIntent.update.mockResolvedValue({
      ...baseIntent,
      status: 'FAILED',
      settledAt: null,
    });

    await service.applyFinalStatus({
      intentId: 'pi_1',
      status: 'FAILED',
      provider: 'STRIPE',
      providerPaymentId: 'external_1',
    });

    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.transaction.update).toHaveBeenCalledTimes(1);
  });
});
