const fs = require("fs");

// 1. telemetry.types.ts
let t = fs.readFileSync("apps/api/src/modules/telemetry/telemetry.types.ts", "utf8");
t = t.replace(
  `export type VehicleTelemetryProviderAdapter = {`,
  `export type VehicleTelemetryProviderAdapter = {`
);
