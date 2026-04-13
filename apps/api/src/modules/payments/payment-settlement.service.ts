import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentIntent, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { PaymentIntentFinalStatus, PaymentProvider } from './payment.types';

interface ApplyFinalStatusInput {
  intentId?: string;
  provider?: PaymentProvider;
  providerPaymentId?: string | null;
  idempotencyKey?: string | null;
  status: PaymentIntentFinalStatus;
  providerReference?: string | null;
  note?: string;
  amount?: number | null;
  currency?: string | null;
}

@Injectable()
export class PaymentSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveIntent(input: {
    intentId?: string;
    provider?: PaymentProvider;
    providerPaymentId?: string | null;
    idempotencyKey?: string | null;
  }): Promise<PaymentIntent | null> {
    if (input.intentId) {
      return this.prisma.paymentIntent.findUnique({
        where: { id: input.intentId },
      });
    }

    if (input.provider && input.providerPaymentId) {
      const byProviderId = await this.prisma.paymentIntent.findFirst({
        where: {
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (byProviderId) {
        return byProviderId;
      }
    }

    if (input.idempotencyKey) {
      return this.prisma.paymentIntent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
    }

    return null;
  }

  async applyFinalStatus(input: ApplyFinalStatusInput): Promise<PaymentIntent> {
    const existing = await this.resolveIntent({
      intentId: input.intentId,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      idempotencyKey: input.idempotencyKey,
    });

    if (!existing) {
      throw new NotFoundException('Payment intent not found');
    }

    this.assertExpectedAmountAndCurrency(
      existing,
      input.amount,
      input.currency,
    );

    return this.prisma.$transaction(async (tx) => {
      const metadata = this.toRecord(existing.metadata) || {};
      const nextMetadata =
        input.note && input.note.trim().length > 0
          ? ({
              ...metadata,
              reconciliationNote: input.note.trim(),
            } as Prisma.InputJsonValue)
          : undefined;

      const updated = await tx.paymentIntent.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          reconciliationState:
            input.status === 'SETTLED' ? 'RECONCILED' : 'DISPUTED',
          settledAt:
            input.status === 'SETTLED' ? new Date() : existing.settledAt,
          providerReference:
            input.providerReference !== undefined
              ? input.providerReference
              : existing.providerReference,
          providerPaymentId:
            input.providerPaymentId !== undefined
              ? input.providerPaymentId
              : existing.providerPaymentId,
          provider:
            input.provider !== undefined ? input.provider : existing.provider,
          metadata: nextMetadata,
        },
      });

      if (input.status === 'SETTLED') {
        await this.creditPendingWalletTopUp(tx, updated);
      } else {
        await this.markTopUpAsFailed(tx, updated);
      }

      return updated;
    });
  }

  private async creditPendingWalletTopUp(
    tx: Prisma.TransactionClient,
    intent: PaymentIntent,
  ): Promise<void> {
    if (!this.isWalletTopUp(intent) || !intent.walletId) {
      return;
    }

    const creditTx = await tx.transaction.findFirst({
      where: {
        paymentIntentId: intent.id,
        walletId: intent.walletId,
        type: 'CREDIT',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!creditTx || creditTx.status === 'POSTED') {
      return;
    }

    await tx.wallet.update({
      where: { id: intent.walletId },
      data: { balance: { increment: creditTx.amount } },
    });

    await tx.transaction.update({
      where: { id: creditTx.id },
      data: {
        status: 'POSTED',
        reconciliationState: 'RECONCILED',
        occurredAt: new Date(),
        reference: creditTx.reference || `TOPUP_SETTLED_${Date.now()}`,
      },
    });
  }

  private async markTopUpAsFailed(
    tx: Prisma.TransactionClient,
    intent: PaymentIntent,
  ): Promise<void> {
    if (!this.isWalletTopUp(intent) || !intent.walletId) {
      return;
    }

    const creditTx = await tx.transaction.findFirst({
      where: {
        paymentIntentId: intent.id,
        walletId: intent.walletId,
        type: 'CREDIT',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!creditTx || creditTx.status === 'POSTED') {
      return;
    }

    await tx.transaction.update({
      where: { id: creditTx.id },
      data: {
        status: 'FAILED',
        reconciliationState: 'DISPUTED',
      },
    });
  }

  private isWalletTopUp(intent: PaymentIntent): boolean {
    const metadata = this.toRecord(intent.metadata);
    return metadata?.flow === 'WALLET_TOPUP';
  }

  private assertExpectedAmountAndCurrency(
    intent: PaymentIntent,
    amount?: number | null,
    currency?: string | null,
  ): void {
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      const normalized = Number(amount.toFixed(2));
      const current = Number(intent.amount.toFixed(2));
      if (normalized !== current) {
        throw new BadRequestException(
          `Amount mismatch. Expected ${intent.amount}, received ${amount}`,
        );
      }
    }

    if (currency && currency.trim().length > 0) {
      if (
        currency.trim().toUpperCase() !== intent.currency.trim().toUpperCase()
      ) {
        throw new BadRequestException(
          `Currency mismatch. Expected ${intent.currency}, received ${currency}`,
        );
      }
    }
  }

  private toRecord(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }
}
