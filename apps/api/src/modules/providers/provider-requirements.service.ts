import { Injectable } from '@nestjs/common'
import { ProviderDocumentType } from '@prisma/client'

export type ProviderComplianceCategory =
  | 'CORPORATE'
  | 'SAFETY'
  | 'TRACEABILITY'
  | 'INTEROPERABILITY'
  | 'OPERATIONS'
  | 'INSURANCE'
  | 'ENVIRONMENT'
  | 'CYBER'
  | 'SITE_PERMITS'
  | 'COMMERCIAL'

export type ProviderComplianceGate = 'KYB' | 'SAFETY' | 'OPERATIONS' | 'INTEGRATION'
export type ProviderRequirementScope = 'PROVIDER' | 'STATION_OWNER'
export type ProviderComplianceMarket = 'GLOBAL' | 'CN' | 'HK' | 'FI'
export type ProviderRequirementCoverageMode = 'ANY' | 'PER_MODEL'

export type ProviderRequirementCondition = {
  key: string
  operator: 'eq' | 'gte' | 'lte' | 'exists' | 'includes'
  value?: string | number | boolean
  description?: string
}

export type ProviderRequirementDefinition = {
  requirementCode: string
  title: string
  description?: string
  gate: ProviderComplianceGate
  category: ProviderComplianceCategory
  isCritical: boolean
  acceptedDocTypes: ProviderDocumentType[]
  conditions?: ProviderRequirementCondition[]
  appliesTo: ProviderRequirementScope
  markets: ProviderComplianceMarket[]
  effectiveFrom?: string
  coverageMode?: ProviderRequirementCoverageMode
  policyDependency?: string
  roadmapAllowedBeforeEffective?: boolean
}

const GATE_ORDER: ProviderComplianceGate[] = ['KYB', 'SAFETY', 'OPERATIONS', 'INTEGRATION']

function sortRequirements(a: ProviderRequirementDefinition, b: ProviderRequirementDefinition): number {
  if (a.gate !== b.gate) return GATE_ORDER.indexOf(a.gate) - GATE_ORDER.indexOf(b.gate)
  if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
  return a.title.localeCompare(b.title)
}

const PROVIDER_REQUIREMENTS: ProviderRequirementDefinition[] = [
  {
    requirementCode: 'PRV_CORP_INCORP',
    title: 'Company registration and legal entity certificate',
    gate: 'KYB',
    category: 'CORPORATE',
    isCritical: true,
    acceptedDocTypes: ['INCORPORATION'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_TAX_REG',
    title: 'Tax registration and operating address evidence',
    gate: 'KYB',
    category: 'CORPORATE',
    isCritical: true,
    acceptedDocTypes: ['TAX_COMPLIANCE'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_BENEFICIAL_OWNERSHIP',
    title: 'Beneficial ownership and directors list',
    gate: 'KYB',
    category: 'CORPORATE',
    isCritical: true,
    acceptedDocTypes: ['INCORPORATION', 'COMMERCIAL_AGREEMENT'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_SIGNATORY_AUTH',
    title: 'Authorized signatory proof (PoA or board resolution)',
    gate: 'KYB',
    category: 'CORPORATE',
    isCritical: true,
    acceptedDocTypes: ['INCORPORATION', 'COMMERCIAL_AGREEMENT'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_PRODUCT_LIABILITY_INSURANCE',
    title: 'Product liability insurance certificate',
    gate: 'KYB',
    category: 'INSURANCE',
    isCritical: true,
    acceptedDocTypes: ['INSURANCE'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_GENERAL_LIABILITY_INSURANCE',
    title: 'General commercial liability insurance certificate',
    gate: 'KYB',
    category: 'INSURANCE',
    isCritical: true,
    acceptedDocTypes: ['INSURANCE'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_UN38_3_REPORT',
    title: 'UN 38.3 test report per battery model',
    gate: 'SAFETY',
    category: 'SAFETY',
    isCritical: true,
    acceptedDocTypes: ['BATTERY_SAFETY_CERTIFICATION'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
    coverageMode: 'PER_MODEL',
  },
  {
    requirementCode: 'PRV_UN38_3_SUMMARY',
    title: 'UN 38.3 test summary per battery model',
    gate: 'SAFETY',
    category: 'SAFETY',
    isCritical: true,
    acceptedDocTypes: ['BATTERY_SAFETY_CERTIFICATION'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
    coverageMode: 'PER_MODEL',
  },
  {
    requirementCode: 'PRV_BATTERY_TECH_FILE',
    title: 'Battery technical file (datasheet, SDS, ratings, protection, packing)',
    gate: 'SAFETY',
    category: 'SAFETY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'BATTERY_SAFETY_CERTIFICATION'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
    coverageMode: 'PER_MODEL',
  },
  {
    requirementCode: 'PRV_TRACEABILITY_UID_SCHEMA',
    title: 'Serial or UID schema and QR labeling rules',
    gate: 'OPERATIONS',
    category: 'TRACEABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_SOH_SOC_METHOD',
    title: 'SoH and SoC measurement methodology',
    gate: 'OPERATIONS',
    category: 'TRACEABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SOP_ACKNOWLEDGEMENT'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_RETIREMENT_QUARANTINE_POLICY',
    title: 'Retirement thresholds and quarantine policy',
    gate: 'OPERATIONS',
    category: 'TRACEABILITY',
    isCritical: true,
    acceptedDocTypes: ['SOP_ACKNOWLEDGEMENT', 'TECHNICAL_CONFORMANCE'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_INCIDENT_RECALL_PROCEDURE',
    title: 'Incident and recall procedure (thermal, swelling, ingress, crash)',
    gate: 'SAFETY',
    category: 'OPERATIONS',
    isCritical: true,
    acceptedDocTypes: ['SOP_ACKNOWLEDGEMENT'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_EOL_TAKEBACK_PLAN',
    title: 'End-of-life producer responsibility and take-back plan',
    gate: 'OPERATIONS',
    category: 'ENVIRONMENT',
    isCritical: true,
    acceptedDocTypes: ['RECYCLING_COMPLIANCE'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_INTERFACE_CONTROL_DOC',
    title: 'Interface control and compatibility dossier',
    gate: 'INTEGRATION',
    category: 'INTEROPERABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_BMS_PROTOCOL_SPEC',
    title: 'BMS communication behavior and update policy',
    gate: 'INTEGRATION',
    category: 'INTEROPERABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'PRV_API_SECURITY_DOC',
    title: 'API and integration security controls',
    gate: 'INTEGRATION',
    category: 'CYBER',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SOP_ACKNOWLEDGEMENT'],
    appliesTo: 'PROVIDER',
    markets: ['GLOBAL'],
  },

  {
    requirementCode: 'PRV_CN_GB38031_2025',
    title: 'China GB 38031-2025 compliance evidence',
    gate: 'SAFETY',
    category: 'SAFETY',
    isCritical: true,
    acceptedDocTypes: ['BATTERY_SAFETY_CERTIFICATION', 'TECHNICAL_CONFORMANCE'],
    appliesTo: 'PROVIDER',
    markets: ['CN'],
    effectiveFrom: '2026-07-01',
    coverageMode: 'PER_MODEL',
    roadmapAllowedBeforeEffective: true,
  },
  {
    requirementCode: 'PRV_CN_GBT40032_2021',
    title: 'China GB/T 40032-2021 swap safety compatibility evidence',
    gate: 'INTEGRATION',
    category: 'INTEROPERABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'BATTERY_SAFETY_CERTIFICATION'],
    appliesTo: 'PROVIDER',
    markets: ['CN'],
    coverageMode: 'PER_MODEL',
  },
  {
    requirementCode: 'PRV_CN_INTERFACE_COMPAT_TEST',
    title: 'China interface and lock or insulation compatibility test reports',
    gate: 'INTEGRATION',
    category: 'INTEROPERABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'PROVIDER',
    markets: ['CN'],
    coverageMode: 'PER_MODEL',
  },

  {
    requirementCode: 'PRV_HK_AIR_TRANSPORT_PACK',
    title: 'Hong Kong air transport lithium battery compliance evidence',
    gate: 'SAFETY',
    category: 'SAFETY',
    isCritical: false,
    acceptedDocTypes: ['BATTERY_SAFETY_CERTIFICATION', 'TECHNICAL_CONFORMANCE'],
    appliesTo: 'PROVIDER',
    markets: ['HK'],
    conditions: [
      {
        key: 'supportsAirShipping',
        operator: 'eq',
        value: true,
      },
    ],
  },
  {
    requirementCode: 'PRV_HK_LOCAL_INSURANCE',
    title: 'Hong Kong local operations insurance endorsement',
    gate: 'KYB',
    category: 'INSURANCE',
    isCritical: true,
    acceptedDocTypes: ['INSURANCE'],
    appliesTo: 'PROVIDER',
    markets: ['HK'],
  },

  {
    requirementCode: 'PRV_FI_EU_2023_1542_PACK',
    title: 'EU Battery Regulation (EU) 2023/1542 technical compliance pack',
    gate: 'SAFETY',
    category: 'SAFETY',
    isCritical: true,
    acceptedDocTypes: ['BATTERY_SAFETY_CERTIFICATION', 'TECHNICAL_CONFORMANCE'],
    appliesTo: 'PROVIDER',
    markets: ['FI'],
    coverageMode: 'PER_MODEL',
  },
  {
    requirementCode: 'PRV_FI_BATTERY_PASSPORT_READINESS',
    title: 'Battery passport readiness evidence',
    gate: 'INTEGRATION',
    category: 'TRACEABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE'],
    appliesTo: 'PROVIDER',
    markets: ['FI'],
    effectiveFrom: '2027-02-18',
    coverageMode: 'PER_MODEL',
    roadmapAllowedBeforeEffective: true,
  },
  {
    requirementCode: 'PRV_FI_PRODUCER_RESPONSIBILITY',
    title: 'Finland producer responsibility registration evidence',
    gate: 'OPERATIONS',
    category: 'ENVIRONMENT',
    isCritical: true,
    acceptedDocTypes: ['RECYCLING_COMPLIANCE'],
    appliesTo: 'PROVIDER',
    markets: ['FI'],
  },
]

const STATION_OWNER_REQUIREMENTS: ProviderRequirementDefinition[] = [
  {
    requirementCode: 'STN_BUSINESS_REGISTRATION',
    title: 'Business registration, tax registration, and site control',
    gate: 'KYB',
    category: 'CORPORATE',
    isCritical: true,
    acceptedDocTypes: ['INCORPORATION', 'TAX_COMPLIANCE', 'COMMERCIAL_AGREEMENT'],
    appliesTo: 'STATION_OWNER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'STN_SITE_LAYOUT_SLD',
    title: 'Site layout drawings and single-line electrical diagram',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'STATION_OWNER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'STN_SOPS_EMERGENCY_TRAINING',
    title: 'Station SOPs, emergency response plan, and training records',
    gate: 'OPERATIONS',
    category: 'OPERATIONS',
    isCritical: true,
    acceptedDocTypes: ['SOP_ACKNOWLEDGEMENT'],
    appliesTo: 'STATION_OWNER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'STN_MAINTENANCE_INSPECTION',
    title: 'Maintenance plan and inspection log templates',
    gate: 'OPERATIONS',
    category: 'OPERATIONS',
    isCritical: true,
    acceptedDocTypes: ['SOP_ACKNOWLEDGEMENT', 'TECHNICAL_CONFORMANCE'],
    appliesTo: 'STATION_OWNER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'STN_NETWORK_CYBER_POLICY',
    title: 'Network diagram, remote access policy, and patch management policy',
    gate: 'INTEGRATION',
    category: 'CYBER',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'STATION_OWNER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'STN_INTEGRATION_ACCEPTANCE_TEST',
    title: 'Provider integration acceptance tests (telemetry, alarms, lockout)',
    gate: 'INTEGRATION',
    category: 'INTEROPERABILITY',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'STATION_OWNER',
    markets: ['GLOBAL'],
  },
  {
    requirementCode: 'STN_INSURANCE_PROPERTY_LIABILITY',
    title: 'Station liability and property or fire insurance evidence',
    gate: 'KYB',
    category: 'INSURANCE',
    isCritical: true,
    acceptedDocTypes: ['INSURANCE'],
    appliesTo: 'STATION_OWNER',
    markets: ['GLOBAL'],
  },

  {
    requirementCode: 'STN_CN_GBT29772_2024',
    title: 'China GB/T 29772-2024 design dossier mapping',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'STATION_OWNER',
    markets: ['CN'],
    effectiveFrom: '2025-07-01',
  },
  {
    requirementCode: 'STN_CN_GBT37295_2019',
    title: 'China GB/T 37295-2019 security protection dossier',
    gate: 'INTEGRATION',
    category: 'CYBER',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'STATION_OWNER',
    markets: ['CN'],
  },

  {
    requirementCode: 'STN_HK_EMSD_ELECTRICAL',
    title: 'Hong Kong EMSD electrical design and commissioning evidence',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'STATION_OWNER',
    markets: ['HK'],
  },
  {
    requirementCode: 'STN_HK_WR1',
    title: 'Hong Kong WR1 work completion certificate',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['SITE_COMPATIBILITY_DECLARATION', 'TECHNICAL_CONFORMANCE'],
    appliesTo: 'STATION_OWNER',
    markets: ['HK'],
  },
  {
    requirementCode: 'STN_HK_FIRE_PLAN',
    title: 'Hong Kong fire safety plan and evacuation procedure',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['SOP_ACKNOWLEDGEMENT', 'TECHNICAL_CONFORMANCE'],
    appliesTo: 'STATION_OWNER',
    markets: ['HK'],
  },
  {
    requirementCode: 'STN_HK_DG_APPROVAL',
    title: 'Hong Kong Dangerous Goods approval or notification evidence',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['SITE_COMPATIBILITY_DECLARATION', 'COMMERCIAL_AGREEMENT'],
    appliesTo: 'STATION_OWNER',
    markets: ['HK'],
    policyDependency: 'HK_DG_THRESHOLD',
  },

  {
    requirementCode: 'STN_FI_TUKES_ELECTRICAL',
    title: 'Finland Tukes electrical contractor and inspection evidence',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['TECHNICAL_CONFORMANCE', 'SITE_COMPATIBILITY_DECLARATION'],
    appliesTo: 'STATION_OWNER',
    markets: ['FI'],
  },
  {
    requirementCode: 'STN_FI_BUILDING_FIRE',
    title: 'Finland building permit artifacts and fire safety design',
    gate: 'SAFETY',
    category: 'SITE_PERMITS',
    isCritical: true,
    acceptedDocTypes: ['SITE_COMPATIBILITY_DECLARATION', 'SOP_ACKNOWLEDGEMENT'],
    appliesTo: 'STATION_OWNER',
    markets: ['FI'],
  },
]

@Injectable()
export class ProviderRequirementsService {
  list(appliesTo?: ProviderRequirementScope): ProviderRequirementDefinition[] {
    const all = [...PROVIDER_REQUIREMENTS, ...STATION_OWNER_REQUIREMENTS]
    const filtered = appliesTo ? all.filter((item) => item.appliesTo === appliesTo) : all
    return [...filtered].sort(sortRequirements)
  }

  listForScope(scope: ProviderRequirementScope = 'PROVIDER'): ProviderRequirementDefinition[] {
    const source = scope === 'PROVIDER' ? PROVIDER_REQUIREMENTS : STATION_OWNER_REQUIREMENTS
    return [...source].sort(sortRequirements)
  }
}
