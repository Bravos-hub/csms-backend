import path from 'path';
import { pathToFileURL } from 'url';
import {
  COMMAND_CONTRACT_SCHEMA_VERSION as BACKEND_SCHEMA_VERSION,
  SUPPORTED_COMMAND_CONTRACT_SCHEMA_VERSIONS as BACKEND_SUPPORTED_SCHEMA_VERSIONS,
  validateCommandRequestContract as validateBackendCommandRequest,
  validateDomainEventContract as validateBackendDomainEvent,
} from '../../apps/worker/src/contracts/commands';
import { KAFKA_TOPICS as BACKEND_KAFKA_TOPICS } from '../../apps/worker/src/contracts/kafka-topics';

type CheckResult = {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
};

type GatewayContractsModule = {
  COMMAND_CONTRACT_SCHEMA_VERSION: string;
  SUPPORTED_COMMAND_CONTRACT_SCHEMA_VERSIONS: readonly string[];
  validateCommandRequestContract: (input: unknown) => { ok: boolean };
  isSupportedCommandContractSchemaVersion: (value: unknown) => boolean;
};

type GatewayEventsModule = {
  validateDomainEventContract: (input: unknown) => { ok: boolean };
};

type GatewayTopicsModule = {
  KAFKA_TOPICS: Record<string, string>;
};

function parseBoolArg(flag: string, fallback: boolean): boolean {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const raw = process.argv[index + 1];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

async function loadModule<T>(absolutePath: string): Promise<T> {
  const moduleUrl = pathToFileURL(absolutePath).href;
  return (await import(moduleUrl)) as T;
}

async function main() {
  const strict = parseBoolArg('--strict', false);
  const workspaceRoot = path.resolve(__dirname, '../../..');
  const gatewayRoot = path.resolve(workspaceRoot, 'ocpp-gateway');

  const checks: CheckResult[] = [];

  const gatewayContractsPath = path.resolve(
    gatewayRoot,
    'apps/gateway/src/contracts/commands.ts',
  );
  const gatewayEventsPath = path.resolve(
    gatewayRoot,
    'apps/gateway/src/contracts/events.ts',
  );
  const gatewayTopicsPath = path.resolve(
    gatewayRoot,
    'apps/gateway/src/contracts/kafka-topics.ts',
  );

  try {
    const [gatewayContracts, gatewayEvents, gatewayTopics] = await Promise.all([
      loadModule<GatewayContractsModule>(gatewayContractsPath),
      loadModule<GatewayEventsModule>(gatewayEventsPath),
      loadModule<GatewayTopicsModule>(gatewayTopicsPath),
    ]);

    checks.push({
      name: 'schema_version',
      ok:
        BACKEND_SCHEMA_VERSION ===
        gatewayContracts.COMMAND_CONTRACT_SCHEMA_VERSION,
      details: {
        backend: BACKEND_SCHEMA_VERSION,
        gateway: gatewayContracts.COMMAND_CONTRACT_SCHEMA_VERSION,
      },
    });

    checks.push({
      name: 'supported_schema_versions',
      ok:
        JSON.stringify(BACKEND_SUPPORTED_SCHEMA_VERSIONS) ===
        JSON.stringify(
          gatewayContracts.SUPPORTED_COMMAND_CONTRACT_SCHEMA_VERSIONS,
        ),
      details: {
        backend: BACKEND_SUPPORTED_SCHEMA_VERSIONS,
        gateway: gatewayContracts.SUPPORTED_COMMAND_CONTRACT_SCHEMA_VERSIONS,
      },
    });

    const topicKeysToCompare = [
      'commandRequests',
      'commandRequestsNodePrefix',
      'sessionControlNodePrefix',
      'commandEvents',
      'commandDeadLetters',
      'stationEvents',
      'sessionEvents',
      'auditEvents',
    ];

    for (const key of topicKeysToCompare) {
      const backendValue =
        BACKEND_KAFKA_TOPICS[key as keyof typeof BACKEND_KAFKA_TOPICS];
      const gatewayValue = gatewayTopics.KAFKA_TOPICS[key];
      checks.push({
        name: `topic.${key}`,
        ok: backendValue === gatewayValue,
        details: { backend: backendValue, gateway: gatewayValue },
      });
    }

    const commandRequest = {
      schemaVersion: BACKEND_SCHEMA_VERSION,
      commandId: 'contract-check-command-id',
      commandType: 'RemoteStartTransaction',
      stationId: 'station-1',
      tenantId: 'tenant-1',
      chargePointId: 'cp-1',
      connectorId: 1,
      requestedBy: { userId: 'user-1', role: 'SYSTEM', orgId: 'org-1' },
      payload: { reason: 'contract-check' },
      requestedAt: new Date().toISOString(),
      timeoutSec: 30,
    };

    const backendCommandValidation =
      validateBackendCommandRequest(commandRequest);
    const gatewayCommandValidation =
      gatewayContracts.validateCommandRequestContract(commandRequest);

    checks.push({
      name: 'command_payload_roundtrip',
      ok: backendCommandValidation.ok && gatewayCommandValidation.ok,
      details: {
        backendOk: backendCommandValidation.ok,
        gatewayOk: gatewayCommandValidation.ok,
      },
    });

    const domainEvent = {
      schemaVersion: BACKEND_SCHEMA_VERSION,
      eventId: 'contract-check-event-id',
      eventType: 'CommandAccepted',
      source: 'ocpp-gateway',
      occurredAt: new Date().toISOString(),
      correlationId: commandRequest.commandId,
      stationId: commandRequest.stationId,
      tenantId: commandRequest.tenantId,
      chargePointId: commandRequest.chargePointId,
      connectorId: commandRequest.connectorId,
      payload: { status: 'Accepted' },
    };

    const backendEventValidation = validateBackendDomainEvent(domainEvent);
    const gatewayEventValidation =
      gatewayEvents.validateDomainEventContract(domainEvent);

    checks.push({
      name: 'event_payload_roundtrip',
      ok: backendEventValidation.ok && gatewayEventValidation.ok,
      details: {
        backendOk: backendEventValidation.ok,
        gatewayOk: gatewayEventValidation.ok,
      },
    });
  } catch (error) {
    checks.push({
      name: 'gateway_module_load',
      ok: !strict,
      details: {
        strict,
        gatewayRoot,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }

  const failedChecks = checks.filter((check) => !check.ok);
  const result = {
    status: failedChecks.length === 0 ? 'ok' : 'failed',
    strict,
    checks,
  };

  console.log(JSON.stringify(result, null, 2));

  if (failedChecks.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
