import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PaymentWebhookEvent, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { PaymentProviderAdapterService } from './payment-provider-adapter.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentProvider } from './payment.types';

interface NormalizedWebhookEvent {
  eventId: string;
  eventType: string;
  status: 'SETTLED' | 'FAILED' | 'CANCELED' | 'EXPIRED' | null;
  providerPaymentId: string | null;
  providerReference: string | null;
  idempotencyKey: string | null;
  amount: number | null;
  currency: string | null;
}

export interface PaymentWebhookProcessResult {
  accepted: boolean;
  duplicate: boolean;
  eventId: string;
  eventType: string;
  intentId: string | null;
  status: string;
  message?: string;
}

@Injectable()
export class PaymentWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: PaymentProviderAdapterService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  async handleWebhook(input: {
    provider: PaymentProvider;
    rawBody: string;
    payload: unknown;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<PaymentWebhookProcessResult> {
    const isValidSignature = this.adapters.verifyWebhookSignature({
      provider: input.provider,
      rawBody: input.rawBody,
      headers: input.headers,
    });

    if (!isValidSignature) {
      throw new UnauthorizedException('Webhook signature verification failed');
    }

    const payload = this.normalizePayload(input.payload, input.rawBody);
    const normalized = this.normalizeEvent(
      input.provider,
      payload,
      input.rawBody,
    );

    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: input.provider,
          eventId: normalized.eventId,
        },
      },
    });

    if (existing) {
      return {
        accepted: true,
        duplicate: true,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        intentId: existing.paymentIntentId,
        status: existing.status,
        message: 'Duplicate webhook ignored',
      };
    }

    const createdEvent = await this.prisma.paymentWebhookEvent.create({
      data: {
        provider: input.provider,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        payload: payload as Prisma.InputJsonValue,
        status: 'RECEIVED',
      },
    });

    if (!normalized.status) {
      await this.markEventStatus(createdEvent.id, {
        status: 'IGNORED',
      });
      return {
        accepted: true,
        duplicate: false,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        intentId: null,
        status: 'IGNORED',
        message: 'Event type does not change payment state',
      };
    }

    const intent = await this.settlement.resolveIntent({
      provider: input.provider,
      providerPaymentId: normalized.providerPaymentId,
      idempotencyKey: normalized.idempotencyKey,
    });

    if (!intent) {
      await this.markEventStatus(createdEvent.id, {
        status: 'FAILED',
        errorMessage: 'No matching payment intent',
      });
      return {
        accepted: true,
        duplicate: false,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        intentId: null,
        status: 'FAILED',
        message: 'No matching payment intent',
      };
    }

    const reconciled = await this.settlement.applyFinalStatus({
      intentId: intent.id,
      provider: input.provider,
      providerPaymentId: normalized.providerPaymentId,
      providerReference: normalized.providerReference,
      idempotencyKey: normalized.idempotencyKey,
      status: normalized.status,
      amount: normalized.amount,
      currency: normalized.currency,
      note: `Webhook event ${normalized.eventType}`,
    });

    await this.markEventStatus(createdEvent.id, {
      status: 'PROCESSED',
      paymentIntentId: reconciled.id,
    });

    return {
      accepted: true,
      duplicate: false,
      eventId: normalized.eventId,
      eventType: normalized.eventType,
      intentId: reconciled.id,
      status: 'PROCESSED',
    };
  }

  private normalizePayload(
    payload: unknown,
    rawBody: string,
  ): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }

    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private normalizeEvent(
    provider: PaymentProvider,
    payload: Record<string, unknown>,
    rawBody: string,
  ): NormalizedWebhookEvent {
    if (provider === 'STRIPE') {
      return this.normalizeStripeEvent(payload, rawBody);
    }

    if (provider === 'FLUTTERWAVE') {
      return this.normalizeFlutterwaveEvent(payload, rawBody);
    }

    if (provider === 'ALIPAY') {
      return this.normalizeAlipayEvent(payload, rawBody);
    }

    return this.normalizeLianLianEvent(payload, rawBody);
  }

  private normalizeStripeEvent(
    payload: Record<string, unknown>,
    rawBody: string,
  ): NormalizedWebhookEvent {
    const eventType = this.readString(payload, 'type') || 'stripe.unknown';
    const eventId =
      this.readString(payload, 'id') || this.fallbackEventId('STRIPE', rawBody);

    const data = this.readObject(payload, 'data');
    const obj = this.readObject(data, 'object');
    const metadata = this.readObject(obj, 'metadata');

    return {
      eventId,
      eventType,
      status: this.mapStripeStatus(eventType),
      providerPaymentId:
        this.readString(obj, 'payment_intent') || this.readString(obj, 'id'),
      providerReference: this.readString(obj, 'id'),
      idempotencyKey:
        this.readString(obj, 'client_reference_id') ||
        this.readString(metadata, 'idempotencyKey'),
      amount: this.readStripeAmount(obj),
      currency: this.readString(obj, 'currency'),
    };
  }

  private normalizeFlutterwaveEvent(
    payload: Record<string, unknown>,
    rawBody: string,
  ): NormalizedWebhookEvent {
    const eventType =
      this.readString(payload, 'event') || 'flutterwave.unknown';
    const data = this.readObject(payload, 'data');

    const eventId =
      this.readString(payload, 'id') ||
      this.readString(data, 'id') ||
      this.readString(data, 'flw_ref') ||
      this.fallbackEventId('FLUTTERWAVE', rawBody);

    return {
      eventId,
      eventType,
      status: this.mapFlutterwaveStatus(this.readString(data, 'status')),
      providerPaymentId:
        this.readString(data, 'id') || this.readString(data, 'flw_ref'),
      providerReference: this.readString(data, 'flw_ref'),
      idempotencyKey: this.readString(data, 'tx_ref'),
      amount: this.readNumber(data, 'amount'),
      currency: this.readString(data, 'currency'),
    };
  }

  private normalizeAlipayEvent(
    payload: Record<string, unknown>,
    rawBody: string,
  ): NormalizedWebhookEvent {
    const eventType =
      this.readString(payload, 'notifyType') ||
      this.readString(payload, 'eventType') ||
      'alipay.unknown';

    const result = this.readObject(payload, 'result');
    const paymentAmount = this.readObject(payload, 'paymentAmount');

    const eventId =
      this.readString(payload, 'notifyId') ||
      this.readString(payload, 'paymentId') ||
      this.fallbackEventId('ALIPAY', rawBody);

    return {
      eventId,
      eventType,
      status: this.mapAlipayStatus(
        this.readString(result, 'resultStatus') ||
          this.readString(result, 'resultCode'),
      ),
      providerPaymentId: this.readString(payload, 'paymentId'),
      providerReference: this.readString(payload, 'paymentId'),
      idempotencyKey: this.readString(payload, 'paymentRequestId'),
      amount: this.readNumber(paymentAmount, 'value'),
      currency: this.readString(paymentAmount, 'currency'),
    };
  }

  private normalizeLianLianEvent(
    payload: Record<string, unknown>,
    rawBody: string,
  ): NormalizedWebhookEvent {
    const eventType =
      this.readString(payload, 'event_type') ||
      this.readString(payload, 'eventType') ||
      'lianlian.unknown';

    const eventId =
      this.readString(payload, 'event_id') ||
      this.readString(payload, 'll_transaction_id') ||
      this.readString(payload, 'merchant_transaction_id') ||
      this.fallbackEventId('LIANLIAN', rawBody);

    return {
      eventId,
      eventType,
      status: this.mapLianLianStatus(
        this.readString(payload, 'status') ||
          this.readString(payload, 'payment_result') ||
          this.readString(payload, 'result'),
      ),
      providerPaymentId:
        this.readString(payload, 'll_transaction_id') ||
        this.readString(payload, 'llTransactionId'),
      providerReference:
        this.readString(payload, 'll_transaction_id') ||
        this.readString(payload, 'llTransactionId'),
      idempotencyKey:
        this.readString(payload, 'merchant_transaction_id') ||
        this.readString(payload, 'merchantTransactionId'),
      amount:
        this.readNumber(payload, 'payment_amount') ||
        this.readNumber(payload, 'amount'),
      currency:
        this.readString(payload, 'payment_currency') ||
        this.readString(payload, 'currency'),
    };
  }

  private mapStripeStatus(
    eventType: string,
  ): 'SETTLED' | 'FAILED' | 'CANCELED' | 'EXPIRED' | null {
    if (
      [
        'checkout.session.completed',
        'payment_intent.succeeded',
        'charge.succeeded',
      ].includes(eventType)
    ) {
      return 'SETTLED';
    }

    if (
      ['checkout.session.expired', 'payment_intent.canceled'].includes(
        eventType,
      )
    ) {
      return 'CANCELED';
    }

    if (
      ['payment_intent.payment_failed', 'charge.failed'].includes(eventType)
    ) {
      return 'FAILED';
    }

    return null;
  }

  private mapFlutterwaveStatus(
    status: string | null,
  ): 'SETTLED' | 'FAILED' | 'CANCELED' | 'EXPIRED' | null {
    const normalized = status?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (['successful', 'success'].includes(normalized)) {
      return 'SETTLED';
    }

    if (['failed', 'error'].includes(normalized)) {
      return 'FAILED';
    }

    if (['cancelled', 'canceled'].includes(normalized)) {
      return 'CANCELED';
    }

    if (normalized === 'expired') {
      return 'EXPIRED';
    }

    return null;
  }

  private mapAlipayStatus(
    status: string | null,
  ): 'SETTLED' | 'FAILED' | 'CANCELED' | 'EXPIRED' | null {
    const normalized = status?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    if (normalized.includes('SUCCESS') || normalized === 'S') {
      return 'SETTLED';
    }

    if (normalized.includes('CANCEL') || normalized.includes('CLOSED')) {
      return 'CANCELED';
    }

    if (normalized.includes('FAIL')) {
      return 'FAILED';
    }

    if (normalized.includes('EXPIRE')) {
      return 'EXPIRED';
    }

    return null;
  }

  private mapLianLianStatus(
    status: string | null,
  ): 'SETTLED' | 'FAILED' | 'CANCELED' | 'EXPIRED' | null {
    const normalized = status?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    if (['SUCCESS', 'SUCCEED', 'PAID', 'SETTLED'].includes(normalized)) {
      return 'SETTLED';
    }

    if (['FAILED', 'FAIL', 'ERROR'].includes(normalized)) {
      return 'FAILED';
    }

    if (['CANCELED', 'CANCELLED', 'CANCEL', 'CLOSED'].includes(normalized)) {
      return 'CANCELED';
    }

    if (['EXPIRED', 'TIMEOUT'].includes(normalized)) {
      return 'EXPIRED';
    }

    return null;
  }

  private readStripeAmount(record: Record<string, unknown>): number | null {
    const amountTotal = this.readNumber(record, 'amount_total');
    if (typeof amountTotal === 'number') {
      return Number((amountTotal / 100).toFixed(2));
    }

    const amount = this.readNumber(record, 'amount');
    if (typeof amount === 'number') {
      return Number((amount / 100).toFixed(2));
    }

    return null;
  }

  private fallbackEventId(provider: PaymentProvider, rawBody: string): string {
    const digest = createHash('sha256')
      .update(rawBody)
      .digest('hex')
      .slice(0, 32);
    return `${provider.toLowerCase()}_${digest}`;
  }

  private async markEventStatus(
    id: string,
    input: {
      status: string;
      paymentIntentId?: string | null;
      errorMessage?: string;
    },
  ): Promise<PaymentWebhookEvent> {
    return this.prisma.paymentWebhookEvent.update({
      where: { id },
      data: {
        status: input.status,
        paymentIntentId:
          input.paymentIntentId !== undefined
            ? input.paymentIntentId
            : undefined,
        errorMessage: input.errorMessage,
        processedAt: new Date(),
      },
    });
  }

  private readString(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = record[key];
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readNumber(
    record: Record<string, unknown>,
    key: string,
  ): number | null {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private readObject(
    record: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    const value = record[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}
