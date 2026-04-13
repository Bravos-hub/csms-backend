import * as fs from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';

type CutoverPhase = 'pre' | 'post' | 'endpoints';

interface CutoverOptions {
  phase: CutoverPhase;
  envFile: string;
  apiBaseUrl: string;
  authToken: string | null;
  skipHealth: boolean;
}

interface ParsedArgs {
  [key: string]: string | boolean;
}

interface WebhookEndpoints {
  stripe: string;
  flutterwave: string;
  alipay: string;
  lianlian: string;
}

const CORE_REQUIRED = [
  'PAYMENT_PROVIDER_TIMEOUT_MS',
  'PAYMENT_WEBHOOK_BASE_URL',
] as const;
const PRE_LEGACY_REQUIRED = [
  'PAYMENT_HEALTHCHECK_URL',
  'PAYMENT_HEALTHCHECK_TIMEOUT_MS',
] as const;
const PROVIDER_REQUIRED = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'FLUTTERWAVE_SECRET_KEY',
  'FLUTTERWAVE_WEBHOOK_SECRET_HASH',
  'ALIPAY_CLIENT_ID',
  'ALIPAY_PRIVATE_KEY',
  'ALIPAY_PUBLIC_KEY',
  'LIANLIAN_MERCHANT_ID',
  'LIANLIAN_SUB_MERCHANT_ID',
  'LIANLIAN_PRIVATE_KEY',
  'LIANLIAN_PUBLIC_KEY',
] as const;

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const normalized = token.slice(2);
    const [rawKey, inlineValue] = normalized.split('=', 2);
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    if (inlineValue !== undefined) {
      result[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    index += 1;
  }

  return result;
}

function readStringArg(
  args: ParsedArgs,
  key: string,
  fallback: string,
): string {
  const value = args[key];
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readBooleanArg(
  args: ParsedArgs,
  key: string,
  fallback: boolean,
): boolean {
  const value = args[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return fallback;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function buildEndpoints(apiBaseUrl: string): WebhookEndpoints {
  const base = normalizeBaseUrl(apiBaseUrl);
  return {
    stripe: `${base}/api/v1/payments/webhooks/stripe`,
    flutterwave: `${base}/api/v1/payments/webhooks/flutterwave`,
    alipay: `${base}/api/v1/payments/webhooks/alipay`,
    lianlian: `${base}/api/v1/payments/webhooks/lianlian`,
  };
}

function loadEnvironment(envFile: string): string | null {
  const absolutePath = path.resolve(envFile);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  loadDotenv({
    path: absolutePath,
    override: true,
  });
  return absolutePath;
}

function envValue(key: string): string | null {
  const raw = process.env[key];
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function missingEnv(keys: readonly string[]): string[] {
  return keys.filter((key) => !envValue(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readServiceHealth(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const servicesRaw = payload['services'];
  if (!Array.isArray(servicesRaw)) {
    return null;
  }

  for (const service of servicesRaw) {
    if (!isRecord(service)) {
      continue;
    }
    const name = service['name'];
    if (typeof name === 'string' && name === 'Payment Gateway') {
      return service;
    }
  }

  return null;
}

async function verifyHealthMetadata(options: {
  apiBaseUrl: string;
  authToken: string;
  phase: CutoverPhase;
}): Promise<void> {
  const endpoint = `${normalizeBaseUrl(options.apiBaseUrl)}/api/v1/analytics/system-health`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${options.authToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `System health request failed (HTTP ${response.status}) at ${endpoint}`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    throw new Error('System health response is not a JSON object');
  }

  const paymentGateway = readServiceHealth(payload);
  if (!paymentGateway) {
    throw new Error(
      'Payment Gateway service entry was not found in services[]',
    );
  }

  const metadata = paymentGateway['metadata'];
  if (!isRecord(metadata)) {
    throw new Error('Payment Gateway metadata is missing or invalid');
  }

  if (options.phase === 'post') {
    const requiredKeys = [
      'configuredProviders',
      'healthyConfiguredProviders',
      'marketCoverage',
      'providers',
    ] as const;
    const missing = requiredKeys.filter((key) => !(key in metadata));
    if (missing.length > 0) {
      throw new Error(
        `Payment Gateway metadata missing post-cutover keys: ${missing.join(', ')}`,
      );
    }
  }
}

function resolveOptions(argv: string[]): CutoverOptions {
  const args = parseArgs(argv);

  const phaseRaw = readStringArg(args, 'phase', 'pre').toLowerCase();
  const phase: CutoverPhase =
    phaseRaw === 'post' || phaseRaw === 'endpoints' ? phaseRaw : 'pre';

  const envFile = readStringArg(args, 'env-file', '.env');
  const apiBaseUrl = readStringArg(
    args,
    'api-base-url',
    envValue('PAYMENT_WEBHOOK_BASE_URL') || 'https://api.evzonecharging.com',
  );
  const authToken =
    readStringArg(args, 'auth-token', '') ||
    envValue('SYSTEM_HEALTH_AUTH_TOKEN') ||
    null;

  return {
    phase,
    envFile,
    apiBaseUrl,
    authToken,
    skipHealth: readBooleanArg(args, 'skip-health', false),
  };
}

async function main(): Promise<void> {
  const options = resolveOptions(process.argv.slice(2));
  const loadedEnvPath = loadEnvironment(options.envFile);
  const endpoints = buildEndpoints(options.apiBaseUrl);

  const expectedFlag = options.phase === 'post' ? 'true' : 'false';
  const flagValue = envValue('PAYMENT_ORCHESTRATION_ENABLED');
  const missing = [
    ...missingEnv(CORE_REQUIRED),
    ...missingEnv(PROVIDER_REQUIRED),
    ...(options.phase === 'pre' ? missingEnv(PRE_LEGACY_REQUIRED) : []),
  ];

  const summary: Record<string, unknown> = {
    phase: options.phase,
    envFile: loadedEnvPath || path.resolve(options.envFile),
    envFileLoaded: Boolean(loadedEnvPath),
    expectedOrchestrationFlag: expectedFlag,
    currentOrchestrationFlag: flagValue,
    endpoints,
    signatureHeaders: {
      stripe: 'Stripe-Signature',
      flutterwave: 'flutterwave-signature',
      alipay: 'signature',
      lianlian: 'signature',
    },
  };

  if (options.phase === 'endpoints') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (missing.length > 0) {
    console.error(
      JSON.stringify(
        {
          status: 'error',
          reason: 'Missing required payment environment values',
          missing,
          ...summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if ((flagValue || '').toLowerCase() !== expectedFlag) {
    console.error(
      JSON.stringify(
        {
          status: 'error',
          reason: `PAYMENT_ORCHESTRATION_ENABLED must be ${expectedFlag} for phase ${options.phase}`,
          ...summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if (!options.skipHealth) {
    if (!options.authToken) {
      console.error(
        JSON.stringify(
          {
            status: 'error',
            reason:
              'Missing auth token for system health verification. Set --auth-token or SYSTEM_HEALTH_AUTH_TOKEN.',
            ...summary,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    await verifyHealthMetadata({
      apiBaseUrl: options.apiBaseUrl,
      authToken: options.authToken,
      phase: options.phase,
    });
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        message: `Payment cutover ${options.phase} checks passed`,
        ...summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        status: 'error',
        reason: message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
