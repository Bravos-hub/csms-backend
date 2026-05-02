import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsArray,
  IsNumber,
  Min,
  Max,
  IsIn,
} from 'class-validator';

const POWERTRAIN_TYPES = ['BEV', 'PHEV', 'HEV', 'ICE'] as const;
const CONNECTOR_TYPES = [
  'TYPE_1',
  'TYPE_2',
  'CCS1',
  'CCS2',
  'CHADEMO',
  'GBT_AC',
  'GBT_DC',
  'TESLA_NACS',
  'TESLA_SCS',
] as const;
const VEHICLE_OWNERSHIP_TYPES = ['PERSONAL', 'ORGANIZATION', 'FLEET'] as const;
const VEHICLE_STATUS_TYPES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'] as const;
const TELEMETRY_PROVIDER_TYPES = [
  'SMARTCAR',
  'ENODE',
  'AUTOPI',
  'OPENDBC',
  'MQTT_BMS',
  'OBD_DONGLE',
  'OEM_API',
  'MANUAL_IMPORT',
  'MOCK',
] as const;

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  vehicleName: string;

  @IsString()
  @IsNotEmpty()
  make: string;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsInt()
  @Min(1980)
  @Max(new Date().getFullYear() + 1)
  yearOfManufacture: number;

  @IsString()
  @IsNotEmpty()
  licensePlate: string;

  @IsIn(POWERTRAIN_TYPES)
  powertrain: (typeof POWERTRAIN_TYPES)[number];

  @IsOptional()
  @IsString()
  countryOfRegistration?: string;

  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  bodyType?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  batteryKwh?: number;

  @IsOptional()
  @IsNumber()
  acMaxKw?: number;

  @IsOptional()
  @IsNumber()
  dcMaxKw?: number;

  @IsOptional()
  @IsArray()
  @IsIn(CONNECTOR_TYPES, { each: true })
  connectors?: Array<(typeof CONNECTOR_TYPES)[number]>;

  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_OWNERSHIP_TYPES)
  ownershipType?: (typeof VEHICLE_OWNERSHIP_TYPES)[number];

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  fleetAccountId?: string;

  @IsOptional()
  @IsString()
  fleetDriverId?: string;

  @IsOptional()
  @IsString()
  fleetDriverGroupId?: string;

  @IsOptional()
  @IsString()
  depotSiteId?: string;

  @IsOptional()
  @IsString()
  operatingRegion?: string;

  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_STATUS_TYPES)
  vehicleStatus?: (typeof VEHICLE_STATUS_TYPES)[number];

  @IsOptional()
  @IsString()
  vehicleRole?: string;

  @IsOptional()
  @IsString()
  @IsIn(TELEMETRY_PROVIDER_TYPES)
  telemetryProvider?: (typeof TELEMETRY_PROVIDER_TYPES)[number];
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  vehicleName?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1980)
  yearOfManufacture?: number;

  @IsOptional()
  @IsString()
  licensePlate?: string;

  @IsOptional()
  @IsIn(POWERTRAIN_TYPES)
  powertrain?: (typeof POWERTRAIN_TYPES)[number];

  @IsOptional()
  @IsString()
  countryOfRegistration?: string;

  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  bodyType?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  batteryKwh?: number;

  @IsOptional()
  @IsNumber()
  acMaxKw?: number;

  @IsOptional()
  @IsNumber()
  dcMaxKw?: number;

  @IsOptional()
  @IsArray()
  @IsIn(CONNECTOR_TYPES, { each: true })
  connectors?: Array<(typeof CONNECTOR_TYPES)[number]>;

  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_OWNERSHIP_TYPES)
  ownershipType?: (typeof VEHICLE_OWNERSHIP_TYPES)[number];

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  fleetAccountId?: string;

  @IsOptional()
  @IsString()
  fleetDriverId?: string;

  @IsOptional()
  @IsString()
  fleetDriverGroupId?: string;

  @IsOptional()
  @IsString()
  depotSiteId?: string;

  @IsOptional()
  @IsString()
  operatingRegion?: string;

  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_STATUS_TYPES)
  vehicleStatus?: (typeof VEHICLE_STATUS_TYPES)[number];

  @IsOptional()
  @IsString()
  vehicleRole?: string;

  @IsOptional()
  @IsString()
  @IsIn(TELEMETRY_PROVIDER_TYPES)
  telemetryProvider?: (typeof TELEMETRY_PROVIDER_TYPES)[number];
}

export class SetActiveVehicleDto {
  @IsOptional()
  @IsString()
  vehicleId: string | null;
}

export class VehiclesScopeQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['personal', 'tenant', 'all'])
  scope?: 'personal' | 'tenant' | 'all';
}
