const fs = require("fs");
let c = fs.readFileSync("apps/api/src/modules/telemetry/smartcar-provider.service.ts", "utf8");

c = c.replace(
  "import { VehicleCommandInput } from './telemetry.types';",
  "import { PrismaService } from '../../prisma.service';\nimport {\n  TelemetryProvider,\n  UnifiedTelemetryData,\n  VehicleCommandInput,\n  VehicleTelemetryProviderAdapter,\n} from './telemetry.types';"
);

c = c.replace(
  "@Injectable()",
  "function buildLineage(\n" +
  "  provider: TelemetryProvider,\n" +
  "  providerId: string | null,\n" +
  "  lastSyncedAt: string | null,\n" +
  "): {\n" +
  "  provider: TelemetryProvider;\n" +
  "  providerId: string | null;\n" +
  "  lastSyncedAt: string | null;\n" +
  "  freshnessMs: number | null;\n" +
  "  isStale: boolean;\n" +
  "} {\n" +
  "  const freshnessMs = lastSyncedAt ? Math.max(0, Date.now() - Date.parse(lastSyncedAt)) : null;\n" +
  "  return {\n" +
  "    provider,\n" +
  "    providerId,\n" +
  "    lastSyncedAt,\n" +
  "    freshnessMs,\n" +
  "    isStale: freshnessMs === null ? true : freshnessMs > 60_000,\n" +
  "  };\n" +
  "}\n\n" +
  "function nowIso(): string {\n" +
  "  return new Date().toISOString();\n" +
  "}\n\n" +
  "@Injectable()"
);
