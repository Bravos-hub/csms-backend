# Payment Orchestration Runbook

## Scope

This runbook covers the provider-backed payment flow in `evzone-backend` for:

- checkout/payment intent creation
- wallet top-up settlement
- provider webhook verification and reconciliation
- payment health reporting

## Feature Flag

- `PAYMENT_ORCHESTRATION_ENABLED=false`
  - Legacy payment flow remains active.
  - Legacy payment health URL probe is used.
- `PAYMENT_ORCHESTRATION_ENABLED=true`
  - Provider-backed orchestration is active.
  - Provider API probes are used for payment health.

## Market Routing

- `CHINA` market: country `CN` only.
- `GLOBAL` market: all non-`CN` countries and unknown geography.

Provider chain and fallback:

- `CHINA`: `LIANLIAN -> ALIPAY`
- `GLOBAL`: `STRIPE -> FLUTTERWAVE`

## Required Environment Variables

Core:

- `PAYMENT_ORCHESTRATION_ENABLED`
- `PAYMENT_PROVIDER_TIMEOUT_MS`
- `PAYMENT_WEBHOOK_BASE_URL`

Stripe:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_BASE_URL` (optional override)
- `STRIPE_SUCCESS_URL` (optional override)
- `STRIPE_CANCEL_URL` (optional override)

Flutterwave:

- `FLUTTERWAVE_SECRET_KEY`
- `FLUTTERWAVE_WEBHOOK_SECRET_HASH`
- `FLUTTERWAVE_API_BASE_URL` (optional override)
- `FLUTTERWAVE_REDIRECT_URL` (optional override)

Alipay:

- `ALIPAY_CLIENT_ID`
- `ALIPAY_PRIVATE_KEY`
- `ALIPAY_PUBLIC_KEY`
- `ALIPAY_API_BASE_URL` (optional override)
- `ALIPAY_CREATE_PAYMENT_PATH` (optional override)
- `ALIPAY_QUERY_PAYMENT_PATH` (optional override)

LianLian:

- `LIANLIAN_MERCHANT_ID`
- `LIANLIAN_SUB_MERCHANT_ID`
- `LIANLIAN_PRIVATE_KEY`
- `LIANLIAN_PUBLIC_KEY`
- `LIANLIAN_API_BASE_URL` (optional override)
- `LIANLIAN_TIMEZONE` (optional override)
- `LIANLIAN_COUNTRY` (optional override)
- `LIANLIAN_PAYMENT_METHOD` (optional override)
- `LIANLIAN_REDIRECT_URL` (optional override)

Legacy compatibility while orchestration is disabled:

- `PAYMENT_HEALTHCHECK_URL`
- `PAYMENT_HEALTHCHECK_BEARER_TOKEN`
- `PAYMENT_HEALTHCHECK_TIMEOUT_MS`

## Webhook Endpoints

All endpoints are unauthenticated and signature-verified:

- `POST /api/v1/payments/webhooks/stripe`
- `POST /api/v1/payments/webhooks/flutterwave`
- `POST /api/v1/payments/webhooks/alipay`
- `POST /api/v1/payments/webhooks/lianlian`

Verification requirements:

- Stripe: `Stripe-Signature` with endpoint secret.
- Flutterwave: `flutterwave-signature` HMAC-SHA256.
- Alipay: RSA256 signature verification using configured public key.
- LianLian: RSA signature verification using configured public key.

## Settlement Rules

- Payment intents and top-up credit transactions are created as `PENDING`.
- Final intent status (`SETTLED`, `FAILED`, `CANCELED`, `EXPIRED`) is applied on verified webhook/reconciliation.
- Wallet credit occurs only once, after `SETTLED`, and only for pending top-up transaction rows.
- Duplicate webhook deliveries are replay-safe via `PaymentWebhookEvent` dedupe on `(provider, eventId)`.

## Health Semantics

Configured providers only participate in rollup; unconfigured providers are reported in metadata and excluded from configured rollup counts.

- `Operational`: all configured providers are healthy.
- `Degraded`: at least one configured provider unhealthy, but required market coverage still exists.
- `Down`: no configured providers, or no healthy configured coverage for China/global market requirements.

## Rollout Checklist

1. Set provider credentials and webhook secrets for target environment.
2. Register provider webhook URLs pointing to `/api/v1/payments/webhooks/*`.
3. Keep `PAYMENT_ORCHESTRATION_ENABLED=false` and verify health endpoint metadata.
4. Enable flag in staging and validate:
   - checkout intent creation returns provider/market/providerPaymentId
   - top-up remains pending until webhook success
   - duplicate webhooks do not double-credit wallet
5. Promote to production with controlled monitoring of payment health and webhook processing.

## Production-Only Cutover Commands

This sequence is for production-first rollout with host-managed `.env` values.

1. Validate endpoint manifest and signature headers:

```bash
npm run ops:payments:cutover:endpoints
```

2. Pre-cutover verification (`PAYMENT_ORCHESTRATION_ENABLED=false`):

```bash
SYSTEM_HEALTH_AUTH_TOKEN="<jwt>" npm run ops:payments:cutover:pre
```

3. After enabling orchestration (`PAYMENT_ORCHESTRATION_ENABLED=true`), verify provider metadata:

```bash
SYSTEM_HEALTH_AUTH_TOKEN="<jwt>" npm run ops:payments:cutover:post
```

Optional arguments for any command:

- `--env-file /path/to/.env`
- `--api-base-url https://api.evzonecharging.com`
- `--auth-token <jwt>`
- `--skip-health true` (env validation and endpoint checks only)

## Provider Webhook Registration (Production)

Register these exact production endpoints in provider dashboards:

- Stripe: `https://api.evzonecharging.com/api/v1/payments/webhooks/stripe`
- Flutterwave: `https://api.evzonecharging.com/api/v1/payments/webhooks/flutterwave`
- Alipay: `https://api.evzonecharging.com/api/v1/payments/webhooks/alipay`
- LianLian: `https://api.evzonecharging.com/api/v1/payments/webhooks/lianlian`

Expected signature headers:

- Stripe: `Stripe-Signature`
- Flutterwave: `flutterwave-signature`
- Alipay: `signature`
- LianLian: `signature`

After registration, store provider-generated webhook signing values in:

- `STRIPE_WEBHOOK_SECRET`
- `FLUTTERWAVE_WEBHOOK_SECRET_HASH`
- `ALIPAY_PUBLIC_KEY` (notification verification key)
- `LIANLIAN_PUBLIC_KEY` (notification verification key)
