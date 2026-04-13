export const PAYMENT_PROVIDER_VALUES = [
  'STRIPE',
  'FLUTTERWAVE',
  'ALIPAY',
  'LIANLIAN',
] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDER_VALUES)[number];

export const PAYMENT_MARKET_VALUES = ['CHINA', 'GLOBAL'] as const;

export type PaymentMarket = (typeof PAYMENT_MARKET_VALUES)[number];

export const PAYMENT_INTENT_FINAL_STATUSES = [
  'SETTLED',
  'FAILED',
  'CANCELED',
  'EXPIRED',
] as const;

export type PaymentIntentFinalStatus =
  (typeof PAYMENT_INTENT_FINAL_STATUSES)[number];

export interface PaymentSessionResult {
  provider: PaymentProvider;
  market: PaymentMarket;
  providerPaymentId: string;
  checkoutUrl: string | null;
  checkoutQrPayload: string | null;
  providerReference: string | null;
}

export interface PaymentProviderHealth {
  provider: PaymentProvider;
  market: PaymentMarket;
  configured: boolean;
  healthy: boolean;
  responseTime: number;
  statusCode?: number;
  message?: string;
}

export interface PaymentProbeResult {
  healthy: boolean;
  responseTime: number;
  statusCode?: number;
  message?: string;
}
