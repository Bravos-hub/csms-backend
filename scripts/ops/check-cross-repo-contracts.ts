import path from 'path';
import { pathToFileURL } from 'url';
import { promises as fs } from 'fs';
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

function pickMatches(input: string, expression: RegExp): string[] {
  const values: string[] = [];
  for (const match of input.matchAll(expression)) {
    const value = match[1];
    if (typeof value === 'string' && value.length > 0) {
      values.push(value);
    }
  }
  return values;
}

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

  try {
    const engineRoot = path.resolve(workspaceRoot, 'evzone-engine');
    const backendRoot = path.resolve(workspaceRoot, 'evzone-backend');

    const engineDiagnosticsModulePath = path.resolve(
      engineRoot,
      'src/diagnostics/module.ts',
    );
    const engineTelemetryAdapterPath = path.resolve(
      engineRoot,
      'src/telemetry/adapter.ts',
    );
    const backendTelemetryControllerPath = path.resolve(
      backendRoot,
      'apps/api/src/modules/telemetry/telemetry.controller.ts',
    );
    const backendDiagnosticsControllerPath = path.resolve(
      backendRoot,
      'apps/api/src/modules/diagnostics/diagnostics.controller.ts',
    );
    const backendTelemetryDtoPath = path.resolve(
      backendRoot,
      'apps/api/src/modules/telemetry/telemetry.dto.ts',
    );

    const [
      engineDiagnosticsSource,
      engineTelemetryAdapterSource,
      backendTelemetryControllerSource,
      backendDiagnosticsControllerSource,
      backendTelemetryDtoSource,
    ] = await Promise.all([
      fs.readFile(engineDiagnosticsModulePath, 'utf8'),
      fs.readFile(engineTelemetryAdapterPath, 'utf8'),
      fs.readFile(backendTelemetryControllerPath, 'utf8'),
      fs.readFile(backendDiagnosticsControllerPath, 'utf8'),
      fs.readFile(backendTelemetryDtoPath, 'utf8'),
    ]);

    const endpointPairs = [
      {
        name: 'telemetry.status_endpoint',
        engineFragment: '/telemetry/vehicles/${vehicleId}/status',
        backendFragment: "@Get('vehicles/:vehicleId/status')",
      },
      {
        name: 'telemetry.command_create_endpoint',
        engineFragment: '/telemetry/vehicles/${vehicleId}/commands',
        backendFragment: "@Post('vehicles/:vehicleId/commands')",
      },
      {
        name: 'telemetry.command_status_endpoint',
        engineFragment: '/telemetry/vehicles/${vehicleId}/commands/${commandId}',
        backendFragment: "@Get('vehicles/:vehicleId/commands/:commandId')",
      },
      {
        name: 'diagnostics.clear_fault_endpoint',
        engineFragment: '/diagnostics/faults/${faultId}',
        backendFragment: "@Delete('faults/:faultId')",
      },
    ] as const;

    for (const endpoint of endpointPairs) {
      checks.push({
        name: endpoint.name,
        ok:
          engineDiagnosticsSource.includes(endpoint.engineFragment) &&
          (endpoint.name.startsWith('diagnostics')
            ? backendDiagnosticsControllerSource.includes(
                endpoint.backendFragment,
              )
            : backendTelemetryControllerSource.includes(endpoint.backendFragment)),
        details: {
          engineFragment: endpoint.engineFragment,
          backendFragment: endpoint.backendFragment,
        },
      });
    }

    const engineCommandTypes = Array.from(
      new Set(
        pickMatches(
          engineTelemetryAdapterSource,
          /\|\s*\{\s*type:\s*'([A-Z_]+)'/g,
        ),
      ),
    ).sort();

    const backendCommandTypesBlock =
      backendTelemetryDtoSource.match(
        /const COMMAND_TYPES = \[(?:.|\r|\n)*?\] as const;/,
      )?.[0] || '';

    const backendCommandTypes = Array.from(
      new Set(pickMatches(backendCommandTypesBlock, /'([A-Z_]+)'/g)),
    ).sort();

    checks.push({
      name: 'telemetry.command_types_alignment',
      ok: JSON.stringify(engineCommandTypes) === JSON.stringify(backendCommandTypes),
      details: {
        engine: engineCommandTypes,
        backend: backendCommandTypes,
      },
    });
  } catch (error) {
    checks.push({
      name: 'engine_contract_load',
      ok: !strict,
      details: {
        strict,
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
