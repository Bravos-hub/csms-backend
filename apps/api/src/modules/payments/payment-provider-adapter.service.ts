import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createSign, createVerify, timingSafeEqual } from 'crypto';
import {
  PaymentMarket,
  PaymentProbeResult,
  PaymentProvider,
  PaymentSessionResult,
} from './payment.types';

interface CreatePaymentInput {
  provider: PaymentProvider;
  market: PaymentMarket;
  amount: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  description?: string;
  customerEmail?: string | null;
}

interface ProviderCreateResult {
  providerPaymentId: string;
  checkoutUrl: string | null;
  checkoutQrPayload: string | null;
  providerReference: string | null;
}

@Injectable()
export class PaymentProviderAdapterService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(provider: PaymentProvider): boolean {
    if (provider === 'STRIPE') {
      return Boolean(this.config.get<string>('STRIPE_SECRET_KEY'));
    }

    if (provider === 'FLUTTERWAVE') {
      return Boolean(this.config.get<string>('FLUTTERWAVE_SECRET_KEY'));
    }

    if (provider === 'ALIPAY') {
      return Boolean(
        this.config.get<string>('ALIPAY_CLIENT_ID') &&
        this.config.get<string>('ALIPAY_PRIVATE_KEY'),
      );
    }

    return Boolean(
      this.config.get<string>('LIANLIAN_MERCHANT_ID') &&
      this.config.get<string>('LIANLIAN_SUB_MERCHANT_ID') &&
      this.config.get<string>('LIANLIAN_PRIVATE_KEY'),
    );
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<PaymentSessionResult> {
    const result =
      input.provider === 'STRIPE'
        ? await this.createStripePayment(input)
        : input.provider === 'FLUTTERWAVE'
          ? await this.createFlutterwavePayment(input)
          : input.provider === 'ALIPAY'
            ? await this.createAlipayPayment(input)
            : await this.createLianLianPayment(input);

    return {
      provider: input.provider,
      market: input.market,
      providerPaymentId: result.providerPaymentId,
      checkoutUrl: result.checkoutUrl,
      checkoutQrPayload: result.checkoutQrPayload,
      providerReference: result.providerReference,
    };
  }

  async probe(provider: PaymentProvider): Promise<PaymentProbeResult> {
    return provider === 'STRIPE'
      ? this.probeStripe()
      : provider === 'FLUTTERWAVE'
        ? this.probeFlutterwave()
        : provider === 'ALIPAY'
          ? this.probeAlipay()
          : this.probeLianLian();
  }

  verifyWebhookSignature(input: {
    provider: PaymentProvider;
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
  }): boolean {
    if (input.provider === 'STRIPE') {
      const signature = this.readHeaderValue(input.headers, 'stripe-signature');
      return this.verifyStripeSignature(input.rawBody, signature);
    }

    if (input.provider === 'FLUTTERWAVE') {
      const signature = this.readHeaderValue(
        input.headers,
        'flutterwave-signature',
      );
      return this.verifyFlutterwaveSignature(input.rawBody, signature);
    }

    if (input.provider === 'ALIPAY') {
      const signature = this.readHeaderValue(input.headers, 'signature');
      return this.verifyRsaSignature(
        input.rawBody,
        signature,
        'ALIPAY_PUBLIC_KEY',
      );
    }

    const signature = this.readHeaderValue(input.headers, 'signature');
    return this.verifyRsaSignature(
      input.rawBody,
      signature,
      'LIANLIAN_PUBLIC_KEY',
    );
  }

  private async createStripePayment(
    input: CreatePaymentInput,
  ): Promise<ProviderCreateResult> {
    const secretKey = this.requiredConfig('STRIPE_SECRET_KEY');
    const apiBase =
      this.config.get<string>('STRIPE_API_BASE_URL') ||
      'https://api.stripe.com';
    const successUrl =
      this.config.get<string>('STRIPE_SUCCESS_URL') ||
      `${this.frontendUrl()}/pay/success`;
    const cancelUrl =
      this.config.get<string>('STRIPE_CANCEL_URL') ||
      `${this.frontendUrl()}/pay/cancel`;

    const amountMinor = Math.round(input.amount * 100);

    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', successUrl);
    body.set('cancel_url', cancelUrl);
    body.set('client_reference_id', input.idempotencyKey);
    body.set(
      'line_items[0][price_data][currency]',
      input.currency.toLowerCase(),
    );
    body.set('line_items[0][price_data][unit_amount]', String(amountMinor));
    body.set(
      'line_items[0][price_data][product_data][name]',
      input.description || 'EVZone Payment',
    );
    body.set('line_items[0][quantity]', '1');
    body.set('metadata[idempotencyKey]', input.idempotencyKey);
    body.set('metadata[correlationId]', input.correlationId);
    body.set('metadata[provider]', input.provider);
    body.set('metadata[market]', input.market);

    const response = await this.fetchWithTimeout(
      `${apiBase}/v1/checkout/sessions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    const payload = await this.parseResponseJson(response);
    this.throwOnFailure(response, payload, 'Stripe create payment failed');

    const id = this.requiredString(payload, 'id', 'Stripe session id');
    const checkoutUrl = this.optionalString(payload, 'url');

    return {
      providerPaymentId: id,
      checkoutUrl,
      checkoutQrPayload: checkoutUrl,
      providerReference: id,
    };
  }

  private async createFlutterwavePayment(
    input: CreatePaymentInput,
  ): Promise<ProviderCreateResult> {
    const secretKey = this.requiredConfig('FLUTTERWAVE_SECRET_KEY');
    const apiBase =
      this.config.get<string>('FLUTTERWAVE_API_BASE_URL') ||
      'https://api.flutterwave.com';
    const redirectUrl =
      this.config.get<string>('FLUTTERWAVE_REDIRECT_URL') ||
      `${this.frontendUrl()}/pay/flutterwave`;

    const requestBody = {
      tx_ref: input.idempotencyKey,
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency,
      redirect_url: redirectUrl,
      payment_options: 'card,banktransfer,ussd,mobilemoney',
      customer: {
        email: input.customerEmail || 'payments@evzone.local',
      },
      customizations: {
        title: 'EVZone Payment',
        description: input.description || 'EVZone checkout payment',
      },
      meta: {
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        provider: input.provider,
        market: input.market,
        ...input.metadata,
      },
    };

    const response = await this.fetchWithTimeout(`${apiBase}/v3/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await this.parseResponseJson(response);
    this.throwOnFailure(response, payload, 'Flutterwave create payment failed');

    const data = this.readObject(payload, 'data');
    const providerPaymentId =
      this.optionalString(data, 'id') ||
      this.optionalString(data, 'flw_ref') ||
      input.idempotencyKey;
    const checkoutUrl = this.optionalString(data, 'link');

    return {
      providerPaymentId,
      checkoutUrl,
      checkoutQrPayload: checkoutUrl,
      providerReference: providerPaymentId,
    };
  }

  private async createAlipayPayment(
    input: CreatePaymentInput,
  ): Promise<ProviderCreateResult> {
    const clientId = this.requiredConfig('ALIPAY_CLIENT_ID');
    const privateKey = this.requiredConfig('ALIPAY_PRIVATE_KEY');
    const apiBase =
      this.config.get<string>('ALIPAY_API_BASE_URL') ||
      'https://open-api.alipayplus.com';
    const createPath =
      this.config.get<string>('ALIPAY_CREATE_PAYMENT_PATH') ||
      '/aps/api/v1/payments/pay';
    const notifyUrl = this.paymentWebhookUrl('alipay');
    const now = new Date().toISOString();

    const requestBody = {
      paymentRequestId: input.idempotencyKey,
      paymentNotifyUrl: notifyUrl,
      paymentAmount: {
        currency: input.currency,
        value: Number(input.amount.toFixed(2)),
      },
      paymentMethod: {
        paymentMethodType: 'CONNECT_WALLET',
      },
      order: {
        referenceOrderId: input.idempotencyKey,
        orderDescription: input.description || 'EVZone checkout payment',
        orderAmount: {
          currency: input.currency,
          value: Number(input.amount.toFixed(2)),
        },
        env: {
          terminalType: 'WEB',
          storeTerminalRequestTime: now,
        },
      },
      settlementStrategy: {
        settlementCurrency: input.currency,
      },
      paymentFactor: {
        isCashierPayment: true,
      },
      merchantRegion: 'CN',
      metadata: {
        correlationId: input.correlationId,
        provider: input.provider,
        market: input.market,
        ...input.metadata,
      },
    };

    const rawBody = JSON.stringify(requestBody);
    const signature = this.signRsa(rawBody, privateKey);

    const response = await this.fetchWithTimeout(`${apiBase}${createPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-id': clientId,
        'request-time': now,
        Signature: `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(signature)}`,
      },
      body: rawBody,
    });

    const payload = await this.parseResponseJson(response);
    this.throwOnFailure(response, payload, 'Alipay create payment failed');

    const paymentId =
      this.optionalString(payload, 'paymentId') ||
      this.optionalString(this.readObject(payload, 'data'), 'paymentId') ||
      input.idempotencyKey;

    const orderCodeForm = this.readObject(payload, 'orderCodeForm');
    const codeDetails =
      orderCodeForm && Array.isArray(orderCodeForm['codeDetails'])
        ? (orderCodeForm['codeDetails'] as unknown[])
        : [];

    const checkoutUrl = this.extractFirstCodeUrl(codeDetails);

    return {
      providerPaymentId: paymentId,
      checkoutUrl,
      checkoutQrPayload: checkoutUrl,
      providerReference: paymentId,
    };
  }

  private async createLianLianPayment(
    input: CreatePaymentInput,
  ): Promise<ProviderCreateResult> {
    const merchantId = this.requiredConfig('LIANLIAN_MERCHANT_ID');
    const subMerchantId = this.requiredConfig('LIANLIAN_SUB_MERCHANT_ID');
    const privateKey = this.requiredConfig('LIANLIAN_PRIVATE_KEY');
    const apiBase =
      this.config.get<string>('LIANLIAN_API_BASE_URL') ||
      'https://gpapi.lianlianpay.com';
    const timezone =
      this.config.get<string>('LIANLIAN_TIMEZONE') || 'Asia/Hong_Kong';
    const country = this.config.get<string>('LIANLIAN_COUNTRY') || 'CN';
    const redirectUrl =
      this.config.get<string>('LIANLIAN_REDIRECT_URL') ||
      `${this.frontendUrl()}/pay/lianlian`;
    const notificationUrl = this.paymentWebhookUrl('lianlian');

    const timestamp = this.compactTimestamp(new Date());
    const requestBody = {
      merchant_transaction_id: input.idempotencyKey,
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      notification_url: notificationUrl,
      redirect_url: redirectUrl,
      country,
      payment_method:
        this.config.get<string>('LIANLIAN_PAYMENT_METHOD') || 'alipay_cn',
      merchant_order: {
        merchant_order_id: input.idempotencyKey,
        merchant_order_time: timestamp,
        order_description: input.description || 'EVZone checkout payment',
        order_amount: Number(input.amount.toFixed(2)),
        order_currency_code: input.currency,
      },
      products: [
        {
          product_name: 'EVZone Payment',
          product_id: input.idempotencyKey,
          product_quantity: 1,
          product_price: Number(input.amount.toFixed(2)),
          product_category: 'EV_CHARGING',
        },
      ],
      customer: {
        customer_type: 'I',
        full_name: 'EVZone Customer',
        email: input.customerEmail || 'payments@evzone.local',
      },
      additional_info: JSON.stringify({
        correlationId: input.correlationId,
        provider: input.provider,
        market: input.market,
        ...input.metadata,
      }),
    };

    const rawBody = JSON.stringify(requestBody);
    const signature = this.signRsa(rawBody, privateKey);

    const response = await this.fetchWithTimeout(
      `${apiBase}/v3/merchants/${encodeURIComponent(merchantId)}/payments`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          timestamp,
          timezone,
          'sign-type': 'RSA',
          signature,
        },
        body: rawBody,
      },
    );

    const payload = await this.parseResponseJson(response);
    this.throwOnFailure(response, payload, 'LianLian create payment failed');

    const providerPaymentId =
      this.optionalString(payload, 'll_transaction_id') ||
      this.optionalString(payload, 'llTransactionId') ||
      this.optionalString(
        this.readObject(payload, 'data'),
        'll_transaction_id',
      ) ||
      input.idempotencyKey;

    const checkoutUrl =
      this.optionalString(payload, 'payment_url') ||
      this.optionalString(this.readObject(payload, 'data'), 'payment_url') ||
      null;

    return {
      providerPaymentId,
      checkoutUrl,
      checkoutQrPayload: checkoutUrl,
      providerReference: providerPaymentId,
    };
  }

  private async probeStripe(): Promise<PaymentProbeResult> {
    if (!this.isConfigured('STRIPE')) {
      return {
        healthy: false,
        responseTime: 0,
        message: 'Provider not configured',
      };
    }

    const apiBase =
      this.config.get<string>('STRIPE_API_BASE_URL') ||
      'https://api.stripe.com';
    const secretKey = this.requiredConfig('STRIPE_SECRET_KEY');

    return this.performProbe(`${apiBase}/v1/balance`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });
  }

  private async probeFlutterwave(): Promise<PaymentProbeResult> {
    if (!this.isConfigured('FLUTTERWAVE')) {
      return {
        healthy: false,
        responseTime: 0,
        message: 'Provider not configured',
      };
    }

    const apiBase =
      this.config.get<string>('FLUTTERWAVE_API_BASE_URL') ||
      'https://api.flutterwave.com';
    const secretKey = this.requiredConfig('FLUTTERWAVE_SECRET_KEY');

    return this.performProbe(`${apiBase}/v3/transactions/0/verify`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });
  }

  private async probeAlipay(): Promise<PaymentProbeResult> {
    if (!this.isConfigured('ALIPAY')) {
      return {
        healthy: false,
        responseTime: 0,
        message: 'Provider not configured',
      };
    }

    const clientId = this.requiredConfig('ALIPAY_CLIENT_ID');
    const privateKey = this.requiredConfig('ALIPAY_PRIVATE_KEY');
    const apiBase =
      this.config.get<string>('ALIPAY_API_BASE_URL') ||
      'https://open-api.alipayplus.com';
    const queryPath =
      this.config.get<string>('ALIPAY_QUERY_PAYMENT_PATH') ||
      '/aps/api/v1/payments/inquiryPayment';
    const now = new Date().toISOString();

    const probeBody = JSON.stringify({
      paymentRequestId: 'evzone_health_probe',
    });
    const signature = this.signRsa(probeBody, privateKey);

    return this.performProbe(`${apiBase}${queryPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-id': clientId,
        'request-time': now,
        Signature: `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(signature)}`,
      },
      body: probeBody,
    });
  }

  private async probeLianLian(): Promise<PaymentProbeResult> {
    if (!this.isConfigured('LIANLIAN')) {
      return {
        healthy: false,
        responseTime: 0,
        message: 'Provider not configured',
      };
    }

    const merchantId = this.requiredConfig('LIANLIAN_MERCHANT_ID');
    const privateKey = this.requiredConfig('LIANLIAN_PRIVATE_KEY');
    const timezone =
      this.config.get<string>('LIANLIAN_TIMEZONE') || 'Asia/Hong_Kong';
    const apiBase =
      this.config.get<string>('LIANLIAN_API_BASE_URL') ||
      'https://gpapi.lianlianpay.com';

    const timestamp = this.compactTimestamp(new Date());
    const probeBody = JSON.stringify({
      merchant_transaction_id: 'evzone_health_probe',
      merchant_id: merchantId,
    });
    const signature = this.signRsa(probeBody, privateKey);

    return this.performProbe(
      `${apiBase}/v3/merchants/${encodeURIComponent(merchantId)}/payments/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          timestamp,
          timezone,
          'sign-type': 'RSA',
          signature,
        },
        body: probeBody,
      },
    );
  }

  private async performProbe(
    url: string,
    init: RequestInit,
  ): Promise<PaymentProbeResult> {
    const started = Date.now();
    try {
      const response = await this.fetchWithTimeout(url, init);
      const responseTime = Date.now() - started;
      const businessFailure = response.status >= 400 && response.status < 500;
      const authFailure = response.status === 401 || response.status === 403;
      const healthy = response.ok || (businessFailure && !authFailure);
      return {
        healthy,
        responseTime,
        statusCode: response.status,
        message: healthy ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        responseTime: Date.now() - started,
        message: this.errorMessage(error),
      };
    }
  }

  private verifyStripeSignature(
    rawBody: string,
    headerSignature?: string,
  ): boolean {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret || !headerSignature) {
      return false;
    }

    const pairs = headerSignature.split(',').map((item) => item.trim());
    const timestamp = pairs
      .find((item) => item.startsWith('t='))
      ?.slice(2)
      ?.trim();
    const signatures = pairs
      .filter((item) => item.startsWith('v1='))
      .map((item) => item.slice(3).trim())
      .filter(Boolean);

    if (!timestamp || signatures.length === 0) {
      return false;
    }

    const signedPayload = `${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    return signatures.some((candidate) =>
      this.safeCompareHex(expected, candidate),
    );
  }

  private verifyFlutterwaveSignature(
    rawBody: string,
    signature?: string,
  ): boolean {
    const secretHash = this.config.get<string>(
      'FLUTTERWAVE_WEBHOOK_SECRET_HASH',
    );
    if (!secretHash || !signature) {
      return false;
    }

    const expected = createHmac('sha256', secretHash)
      .update(rawBody)
      .digest('base64');

    return this.safeCompareString(expected, signature.trim());
  }

  private verifyRsaSignature(
    rawBody: string,
    signatureHeader: string | undefined,
    publicKeyEnv: 'ALIPAY_PUBLIC_KEY' | 'LIANLIAN_PUBLIC_KEY',
  ): boolean {
    const publicKey = this.config.get<string>(publicKeyEnv);
    if (!publicKey || !signatureHeader) {
      return false;
    }

    const signature = this.extractSignatureValue(signatureHeader);
    if (!signature) {
      return false;
    }

    const candidates = [signature];
    try {
      const decoded = decodeURIComponent(signature);
      if (decoded !== signature) {
        candidates.push(decoded);
      }
    } catch {
      // Ignore malformed URI encoding and continue with raw signature.
    }

    for (const candidate of candidates) {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(rawBody);
      verifier.end();
      if (verifier.verify(publicKey, Buffer.from(candidate, 'base64'))) {
        return true;
      }
    }

    return false;
  }

  private extractSignatureValue(headerValue: string): string | null {
    const trimmed = headerValue.trim();
    if (!trimmed) {
      return null;
    }

    if (!trimmed.includes(',')) {
      if (trimmed.toLowerCase().startsWith('signature=')) {
        return trimmed.slice('signature='.length).trim();
      }
      return trimmed;
    }

    const parts = trimmed.split(',').map((item) => item.trim());
    for (const part of parts) {
      if (part.toLowerCase().startsWith('signature=')) {
        return part.slice('signature='.length).trim();
      }
    }

    return null;
  }

  private signRsa(payload: string, privateKey: string): string {
    const signer = createSign('RSA-SHA256');
    signer.update(payload);
    signer.end();
    return signer.sign(privateKey, 'base64');
  }

  private extractFirstCodeUrl(codeDetails: unknown[]): string | null {
    for (const row of codeDetails) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        continue;
      }

      const codeValue = (row as Record<string, unknown>)['codeValue'];
      if (typeof codeValue === 'string' && codeValue.trim().length > 0) {
        return codeValue.trim();
      }
    }

    return null;
  }

  private compactTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  private paymentWebhookUrl(
    provider: 'stripe' | 'flutterwave' | 'alipay' | 'lianlian',
  ): string {
    const base =
      this.config.get<string>('PAYMENT_WEBHOOK_BASE_URL') ||
      this.frontendUrl().replace('portal.', 'api.');
    const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${normalized}/api/v1/payments/webhooks/${provider}`;
  }

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') ||
      'https://portal.evzonecharging.com'
    );
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const timeoutMs = this.readPositiveInt(
      this.config.get<string>('PAYMENT_PROVIDER_TIMEOUT_MS'),
      15000,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponseJson(
    response: Response,
  ): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { raw: text };
    } catch {
      return { raw: text };
    }
  }

  private throwOnFailure(
    response: Response,
    payload: Record<string, unknown>,
    message: string,
  ): void {
    if (response.ok) {
      const statusText = this.optionalString(payload, 'status');
      if (
        statusText &&
        ['error', 'failed', 'fail'].includes(statusText.toLowerCase())
      ) {
        throw new Error(`${message}: ${JSON.stringify(payload).slice(0, 300)}`);
      }
      return;
    }

    throw new Error(
      `${message} (HTTP ${response.status}): ${JSON.stringify(payload).slice(0, 300)}`,
    );
  }

  private requiredConfig(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) {
      throw new Error(`${key} is not configured`);
    }
    return value;
  }

  private requiredString(
    record: Record<string, unknown>,
    key: string,
    context: string,
  ): string {
    const value = this.optionalString(record, key);
    if (!value) {
      throw new Error(`${context} is missing`);
    }
    return value;
  }

  private optionalString(
    record: Record<string, unknown> | null | undefined,
    key: string,
  ): string | null {
    if (!record) {
      return null;
    }

    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
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

  private readPositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private readHeaderValue(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | undefined {
    const direct = headers[key];
    if (typeof direct === 'string') {
      return direct;
    }
    if (
      Array.isArray(direct) &&
      direct.length > 0 &&
      typeof direct[0] === 'string'
    ) {
      return direct[0];
    }

    const lower = Object.keys(headers).find(
      (headerKey) => headerKey.toLowerCase() === key.toLowerCase(),
    );
    if (!lower) {
      return undefined;
    }

    const value = headers[lower];
    if (typeof value === 'string') {
      return value;
    }
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === 'string'
    ) {
      return value[0];
    }

    return undefined;
  }

  private safeCompareHex(left: string, right: string): boolean {
    if (!left || !right || left.length !== right.length) {
      return false;
    }

    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private safeCompareString(left: string, right: string): boolean {
    if (left.length !== right.length) {
      return false;
    }

    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
