import { Injectable } from '@nestjs/common';
import {
  PaymentMarket,
  PaymentProvider,
  PaymentSessionResult,
} from './payment.types';
import {
  PaymentMarketResolution,
  PaymentMarketResolverService,
} from './payment-market-resolver.service';
import { PaymentProviderAdapterService } from './payment-provider-adapter.service';

interface OrchestratePaymentInput {
  amount: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  description?: string;
  customerEmail?: string | null;
  metadata?: Record<string, unknown>;
  userId?: string;
  guestGeo?: {
    zoneId?: string | null;
    country?: string | null;
    region?: string | null;
  };
}

export interface OrchestratedPaymentResult extends PaymentSessionResult {
  attempts: Array<{
    provider: PaymentProvider;
    ok: boolean;
    error?: string;
    skipped?: boolean;
  }>;
  marketResolution: PaymentMarketResolution;
}

@Injectable()
export class PaymentOrchestrationService {
  constructor(
    private readonly marketResolver: PaymentMarketResolverService,
    private readonly adapters: PaymentProviderAdapterService,
  ) {}

  async createPayment(
    input: OrchestratePaymentInput,
  ): Promise<OrchestratedPaymentResult> {
    const marketResolution = input.userId
      ? await this.marketResolver.resolveForUser(input.userId)
      : await this.marketResolver.resolveForGuest(input.guestGeo || {});

    const chain = this.providerChain(marketResolution.market);
    const attempts: OrchestratedPaymentResult['attempts'] = [];

    for (const provider of chain) {
      if (!this.adapters.isConfigured(provider)) {
        attempts.push({
          provider,
          ok: false,
          skipped: true,
          error: 'not_configured',
        });
        continue;
      }

      try {
        const session = await this.adapters.createPayment({
          provider,
          market: marketResolution.market,
          amount: input.amount,
          currency: input.currency,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          description: input.description,
          customerEmail: input.customerEmail,
          metadata: input.metadata || {},
        });

        attempts.push({ provider, ok: true });

        return {
          ...session,
          attempts,
          marketResolution,
        };
      } catch (error) {
        attempts.push({
          provider,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new Error(
      `No provider succeeded for market ${marketResolution.market}: ${attempts
        .map((attempt) => `${attempt.provider}:${attempt.error || 'failed'}`)
        .join('; ')}`,
    );
  }

  providerChain(market: PaymentMarket): PaymentProvider[] {
    if (market === 'CHINA') {
      return ['LIANLIAN', 'ALIPAY'];
    }

    return ['STRIPE', 'FLUTTERWAVE'];
  }
}
