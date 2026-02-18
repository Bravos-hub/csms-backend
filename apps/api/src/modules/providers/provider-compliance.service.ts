import { ForbiddenException, Injectable } from '@nestjs/common'
import { ProviderDocument, SwapProvider } from '@prisma/client'
import { PrismaService } from '../../prisma.service'
import { ProviderAuthzService } from './provider-authz.service'
import {
  ProviderComplianceGate,
  ProviderRequirementDefinition,
  ProviderRequirementsService,
} from './provider-requirements.service'
import {
  ProviderCompliancePolicyData,
  ProviderCompliancePolicyService,
} from './provider-compliance-policy.service'

type ComplianceScope = 'PROVIDER' | 'RELATIONSHIP'

type ComplianceDocument = {
  id: string
  providerId?: string
  relationshipId?: string
  ownerOrgId?: string
  type: ProviderDocument['type']
  requirementCode?: string
  name: string
  fileUrl: string
  issueDate?: string
  expiryDate?: string
  coveredModels?: string[]
  coveredSites?: string[]
  uploadedAt: string
  uploadedBy?: string
  status: ProviderDocument['status']
  rejectionReason?: string
}

type GateStatus = {
  gate: ProviderComplianceGate
  required: number
  met: number
  criticalRequired: number
  criticalMet: number
  missingCritical: string[]
  missingRecommended: string[]
  status: 'PASS' | 'WARN' | 'BLOCKED'
}

type RequirementEval = {
  requirement: ProviderRequirementDefinition
  applies: boolean
  downgradedPreEffective: boolean
  satisfied: boolean
  matchedDocumentIds: string[]
}

type ComplianceResult = {
  scope: ComplianceScope
  targetId: string
  providerId: string
  relationshipId?: string
  ownerOrgId?: string
  evaluatedAt: string
  gateStatuses: GateStatus[]
  missingCritical: string[]
  missingRecommended: string[]
  expiringSoon: ComplianceDocument[]
  expiredCritical: ComplianceDocument[]
  overallState: 'READY' | 'WARN' | 'BLOCKED'
  blockerReasonCodes: string[]
  policyWarnings: string[]
  pendingActivation: string[]
}

const GATE_ORDER: ProviderComplianceGate[] = ['KYB', 'SAFETY', 'OPERATIONS', 'INTEGRATION']
const EXPIRY_WARNING_DAYS = 30

function parseDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isExpiringSoon(document: ComplianceDocument, now: Date): boolean {
  const expiry = parseDate(document.expiryDate)
  if (!expiry || expiry < now) return false
  const diffMs = expiry.getTime() - now.getTime()
  return diffMs <= EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000
}

function isDocumentVerified(document: ComplianceDocument): boolean {
  return document.status === 'APPROVED'
}

function mapComplianceMarkets(provider: {
  region?: string | null
  regions?: string[]
  countries?: string[]
  complianceMarkets?: string[]
}): Array<'CN' | 'HK' | 'FI'> {
  const values = [
    ...(provider.countries || []),
    ...(provider.regions || []),
    provider.region || '',
    ...(provider.complianceMarkets || []),
  ]
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean)

  const markets = new Set<'CN' | 'HK' | 'FI'>()
  values.forEach((value) => {
    if (value === 'CN' || value.includes('CHINA')) markets.add('CN')
    if (value === 'HK' || value.includes('HONG KONG')) markets.add('HK')
    if (value === 'FI' || value.includes('FINLAND')) markets.add('FI')
  })

  return Array.from(markets)
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function getProfileBoolean(profile: Record<string, unknown>, key: string): boolean {
  const raw = profile[key]
  return raw === true || raw === 'true' || raw === 1
}

function getProfileNumber(profile: Record<string, unknown>, key: string): number | null {
  const raw = profile[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function getProfileStringArray(profile: Record<string, unknown>, key: string): string[] {
  const raw = profile[key]
  if (!Array.isArray(raw)) return []
  return raw.map((item) => String(item).trim()).filter(Boolean)
}

function evaluateCondition(
  condition: NonNullable<ProviderRequirementDefinition['conditions']>[number],
  provider: Pick<SwapProvider, 'standard' | 'countries' | 'regions'>,
  profile: Record<string, unknown>,
): boolean {
  if (condition.key === 'crossBorderShipping') {
    const inferredCrossBorder = (provider.countries?.length || 0) > 1 || (provider.regions?.length || 0) > 1
    if (condition.operator === 'eq') return inferredCrossBorder === Boolean(condition.value)
    return inferredCrossBorder
  }

  if (condition.key === 'supportsInteroperability') {
    const isInterop = provider.standard === 'Universal'
    if (condition.operator === 'eq') return isInterop === Boolean(condition.value)
    return isInterop
  }

  if (condition.key === 'supportsAirShipping') {
    const supportsAirShipping = getProfileBoolean(profile, 'supportsAirShipping')
    if (condition.operator === 'eq') return supportsAirShipping === Boolean(condition.value)
    return supportsAirShipping
  }

  const numericValue = getProfileNumber(profile, condition.key)
  if (condition.operator === 'gte' && typeof condition.value === 'number') {
    return numericValue != null && numericValue >= condition.value
  }
  if (condition.operator === 'lte' && typeof condition.value === 'number') {
    return numericValue != null && numericValue <= condition.value
  }

  if (condition.operator === 'includes' && typeof condition.value === 'string') {
    const values = getProfileStringArray(profile, condition.key)
    return values.includes(condition.value)
  }

  if (condition.operator === 'exists') {
    return profile[condition.key] != null
  }

  if (condition.operator === 'eq') {
    return profile[condition.key] === condition.value
  }

  return true
}

function requirementMatchesMarket(requirement: ProviderRequirementDefinition, activeMarkets: Array<'CN' | 'HK' | 'FI'>): boolean {
  if (requirement.markets.includes('GLOBAL')) return true
  return requirement.markets.some((market) => activeMarkets.includes(market as 'CN' | 'HK' | 'FI'))
}

function filterActiveMarketsByPolicy(
  activeMarkets: Array<'CN' | 'HK' | 'FI'>,
  policyMarkets: Array<'CN' | 'HK' | 'FI'>,
): Array<'CN' | 'HK' | 'FI'> {
  if (policyMarkets.length === 0) return []
  const allowed = new Set(policyMarkets)
  return activeMarkets.filter((market) => allowed.has(market))
}

function mapDocument(document: ProviderDocument): ComplianceDocument {
  return {
    id: document.id,
    providerId: document.providerId || undefined,
    relationshipId: document.relationshipId || undefined,
    ownerOrgId: document.ownerOrgId || undefined,
    type: document.type,
    requirementCode: document.requirementCode || undefined,
    name: document.name,
    fileUrl: document.fileUrl,
    issueDate: document.issueDate?.toISOString(),
    expiryDate: document.expiryDate?.toISOString(),
    coveredModels: document.coveredModels,
    coveredSites: document.coveredSites,
    uploadedAt: document.uploadedAt.toISOString(),
    uploadedBy: document.uploadedBy || undefined,
    status: document.status,
    rejectionReason: document.rejectionReason || undefined,
  }
}

@Injectable()
export class ProviderComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: ProviderAuthzService,
    private readonly providerRequirementsService: ProviderRequirementsService,
    private readonly policyService: ProviderCompliancePolicyService,
  ) {}

  private evaluateRequirementApplies(options: {
    requirement: ProviderRequirementDefinition
    provider: Pick<SwapProvider, 'standard' | 'countries' | 'regions'>
    profile: Record<string, unknown>
    markets: Array<'CN' | 'HK' | 'FI'>
    policy: ProviderCompliancePolicyData
    policyWarnings: Set<string>
  }): boolean {
    const { requirement, provider, profile, markets, policy, policyWarnings } = options

    if (!requirementMatchesMarket(requirement, markets)) return false

    if (requirement.policyDependency === 'HK_DG_THRESHOLD') {
      if (!markets.includes('HK')) return false

      const threshold = policy.hk.dg.thresholdKwh
      if (policy.hk.dg.requireConfig && (threshold == null || !Number.isFinite(threshold))) {
        policyWarnings.add('HK_DG_THRESHOLD_UNCONFIGURED')
        return false
      }

      const storedEnergyKwh = getProfileNumber(profile, 'storedEnergyKwh')
      const dgClassifications = getProfileStringArray(profile, 'dgClassifications').map((item) => item.toUpperCase())
      const class9aLabel = (policy.hk.dg.class9aLabel || 'DG_CLASS_9A').toUpperCase()

      const triggeredByEnergy = typeof threshold === 'number' && storedEnergyKwh != null && storedEnergyKwh >= threshold
      const triggeredByClass = dgClassifications.includes(class9aLabel)

      if (!triggeredByEnergy && !triggeredByClass) return false
    }

    if (!requirement.conditions?.length) return true
    return requirement.conditions.every((condition) => evaluateCondition(condition, provider, profile))
  }

  private evaluateRequirementSatisfaction(options: {
    requirement: ProviderRequirementDefinition
    documents: ComplianceDocument[]
    providerModels: string[]
  }): { satisfied: boolean; matchedDocumentIds: string[] } {
    const { requirement, documents, providerModels } = options

    const matchingDocs = documents.filter((doc) => {
      if (!isDocumentVerified(doc)) return false
      if (doc.requirementCode) return doc.requirementCode === requirement.requirementCode
      return requirement.acceptedDocTypes.includes(doc.type)
    })

    if (matchingDocs.length === 0) return { satisfied: false, matchedDocumentIds: [] }

    if (requirement.coverageMode !== 'PER_MODEL') {
      return {
        satisfied: true,
        matchedDocumentIds: [matchingDocs[0].id],
      }
    }

    if (providerModels.length === 0) {
      return {
        satisfied: true,
        matchedDocumentIds: [matchingDocs[0].id],
      }
    }

    const coveredByModel = new Map<string, string[]>()
    providerModels.forEach((model) => coveredByModel.set(model, []))

    matchingDocs.forEach((doc) => {
      const models = doc.coveredModels || []
      models.forEach((model) => {
        if (coveredByModel.has(model)) coveredByModel.get(model)?.push(doc.id)
      })
    })

    const missingModel = providerModels.find((model) => (coveredByModel.get(model) || []).length === 0)
    if (missingModel) {
      return { satisfied: false, matchedDocumentIds: [] }
    }

    const unique = new Set<string>()
    coveredByModel.forEach((ids) => ids.forEach((id) => unique.add(id)))
    return { satisfied: true, matchedDocumentIds: Array.from(unique) }
  }

  private buildCompliance(options: {
    scope: ComplianceScope
    targetId: string
    provider: Pick<
      SwapProvider,
      'id' | 'standard' | 'countries' | 'regions' | 'region' | 'batteriesSupported' | 'complianceMarkets' | 'complianceProfile'
    >
    relationship?: { id: string; ownerOrgId: string; complianceMarkets: string[]; complianceProfile: unknown }
    documents: ComplianceDocument[]
    requirements: ProviderRequirementDefinition[]
    policy: ProviderCompliancePolicyData
  }): ComplianceResult {
    const { scope, targetId, provider, relationship, documents, requirements, policy } = options
    const now = new Date()
    const policyWarnings = new Set<string>()

    const providerMarkets = mapComplianceMarkets(provider)
    const relationshipMarkets = relationship
      ? mapComplianceMarkets({ complianceMarkets: relationship.complianceMarkets })
      : []
    const inferredMarkets = Array.from(new Set([...(providerMarkets || []), ...(relationshipMarkets || [])]))
    const activeMarkets = filterActiveMarketsByPolicy(inferredMarkets, policy.markets)

    const providerProfile = asObject(provider.complianceProfile)
    const relationshipProfile = relationship ? asObject(relationship.complianceProfile) : {}
    const mergedProfile = { ...providerProfile, ...relationshipProfile }

    const providerModels = (provider.batteriesSupported || []).map((item) => String(item)).filter(Boolean)

    const evaluations: RequirementEval[] = requirements.map((requirement) => {
      const applies = this.evaluateRequirementApplies({
        requirement,
        provider,
        profile: mergedProfile,
        markets: activeMarkets,
        policy,
        policyWarnings,
      })

      if (!applies) {
        return {
          requirement,
          applies: false,
          downgradedPreEffective: false,
          satisfied: true,
          matchedDocumentIds: [],
        }
      }

      const effectiveDate = parseDate(requirement.effectiveFrom)
      const downgradedPreEffective =
        Boolean(effectiveDate && effectiveDate > now) &&
        policy.effectiveDateMode === 'WARN_BEFORE_ENFORCE' &&
        (requirement.roadmapAllowedBeforeEffective ?? policy.roadmapAllowedBeforeEffective)

      const { satisfied, matchedDocumentIds } = this.evaluateRequirementSatisfaction({
        requirement,
        documents,
        providerModels,
      })

      return {
        requirement,
        applies: true,
        downgradedPreEffective,
        satisfied,
        matchedDocumentIds,
      }
    })

    const activeEvaluations = evaluations.filter((item) => item.applies)

    const gateStatuses: GateStatus[] = GATE_ORDER.map((gate) => {
      const gateItems = activeEvaluations.filter((item) => item.requirement.gate === gate)
      const missingCritical = gateItems
        .filter((item) => !item.satisfied && item.requirement.isCritical && !item.downgradedPreEffective)
        .map((item) => item.requirement.requirementCode)
      const missingRecommended = gateItems
        .filter((item) => !item.satisfied && (!item.requirement.isCritical || item.downgradedPreEffective))
        .map((item) => item.requirement.requirementCode)

      const met = gateItems.filter((item) => item.satisfied).length
      const criticalRequired = gateItems.filter((item) => item.requirement.isCritical && !item.downgradedPreEffective).length
      const criticalMet = gateItems.filter((item) => item.satisfied && item.requirement.isCritical && !item.downgradedPreEffective).length
      const status: GateStatus['status'] =
        missingCritical.length > 0 ? 'BLOCKED' : missingRecommended.length > 0 ? 'WARN' : 'PASS'

      return {
        gate,
        required: gateItems.length,
        met,
        criticalRequired,
        criticalMet,
        missingCritical,
        missingRecommended,
        status,
      }
    })

    const missingCritical = Array.from(new Set(gateStatuses.flatMap((item) => item.missingCritical)))
    const missingRecommended = Array.from(new Set(gateStatuses.flatMap((item) => item.missingRecommended)))

    const matchedCriticalRequirementCodes = new Set(
      activeEvaluations
        .filter((item) => item.requirement.isCritical && !item.downgradedPreEffective)
        .map((item) => item.requirement.requirementCode),
    )

    const expiringSoon = documents.filter((item) => isDocumentVerified(item) && isExpiringSoon(item, now))
    const expiredCritical = documents.filter((item) => {
      if (!isDocumentVerified(item)) return false
      const expiry = parseDate(item.expiryDate)
      if (!expiry || expiry >= now) return false

      const matchedRequirement = activeEvaluations.find((evaluation) => {
        if (!matchedCriticalRequirementCodes.has(evaluation.requirement.requirementCode)) return false
        if (item.requirementCode) return item.requirementCode === evaluation.requirement.requirementCode
        return evaluation.requirement.acceptedDocTypes.includes(item.type)
      })
      return Boolean(matchedRequirement)
    })

    const pendingActivation = Array.from(
      new Set(
        activeEvaluations
          .filter((item) => item.downgradedPreEffective)
          .map((item) => item.requirement.requirementCode),
      ),
    )

    const blockerReasonCodes = [
      ...missingCritical.map((code) => `MISSING_${code}`),
      ...expiredCritical.map((item) => `DOC_EXPIRED_CRITICAL:${item.id}`),
    ]

    const overallState =
      blockerReasonCodes.length > 0
        ? 'BLOCKED'
        : missingRecommended.length > 0 || expiringSoon.length > 0 || policyWarnings.size > 0
          ? 'WARN'
          : 'READY'

    return {
      scope,
      targetId,
      providerId: provider.id,
      relationshipId: relationship?.id,
      ownerOrgId: relationship?.ownerOrgId,
      evaluatedAt: now.toISOString(),
      gateStatuses,
      missingCritical,
      missingRecommended,
      expiringSoon,
      expiredCritical,
      overallState,
      blockerReasonCodes,
      policyWarnings: Array.from(policyWarnings),
      pendingActivation,
    }
  }

  private async assertProviderComplianceAccess(providerId: string, actorId?: string) {
    const actor = await this.authz.getActor(actorId)

    if (this.authz.isProviderRole(actor.role)) {
      this.authz.assertProviderScope(actor, providerId)
      return
    }

    if (this.authz.isOwnerRole(actor.role)) {
      if (!actor.organizationId) {
        throw new ForbiddenException('Authenticated owner user has no organizationId')
      }
      const scopedRelationship = await this.prisma.providerRelationship.findFirst({
        where: {
          providerId,
          ownerOrgId: actor.organizationId,
        },
        select: { id: true },
      })
      if (!scopedRelationship) {
        throw new ForbiddenException('Provider is outside your authenticated organization scope')
      }
      return
    }

    if (!this.authz.isPlatformOps(actor.role)) {
      throw new ForbiddenException('You do not have access to provider compliance status')
    }
  }

  async getProviderComplianceStatus(providerId: string, actorId?: string) {
    await this.assertProviderComplianceAccess(providerId, actorId)

    const [provider, documentsRaw, policyRecord] = await Promise.all([
      this.prisma.swapProvider.findUniqueOrThrow({
        where: { id: providerId },
        select: {
          id: true,
          standard: true,
          countries: true,
          regions: true,
          region: true,
          batteriesSupported: true,
          complianceMarkets: true,
          complianceProfile: true,
        },
      }),
      this.prisma.providerDocument.findMany({
        where: { providerId },
        orderBy: { uploadedAt: 'desc' },
      }),
      this.policyService.getProviderPolicy(),
    ])

    const documents = documentsRaw.map(mapDocument)
    const requirements = this.providerRequirementsService.listForScope('PROVIDER')

    return this.buildCompliance({
      scope: 'PROVIDER',
      targetId: providerId,
      provider,
      documents,
      requirements,
      policy: this.policyService.normalizePolicy(policyRecord.data),
    })
  }

  async getProviderComplianceStatuses(providerIds: string[], actorId?: string) {
    const unique = Array.from(new Set(providerIds.filter(Boolean)))
    if (unique.length === 0) return []
    return Promise.all(unique.map((providerId) => this.getProviderComplianceStatus(providerId, actorId)))
  }

  async getRelationshipComplianceStatus(relationshipId: string, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const relationship = await this.prisma.providerRelationship.findUniqueOrThrow({
      where: { id: relationshipId },
      select: {
        id: true,
        providerId: true,
        ownerOrgId: true,
        complianceMarkets: true,
        complianceProfile: true,
      },
    })

    this.authz.assertRelationshipScopedAccess(actor, {
      providerId: relationship.providerId,
      ownerOrgId: relationship.ownerOrgId,
    })

    const [provider, docsRaw, policyRecord] = await Promise.all([
      this.prisma.swapProvider.findUniqueOrThrow({
        where: { id: relationship.providerId },
        select: {
          id: true,
          standard: true,
          countries: true,
          regions: true,
          region: true,
          batteriesSupported: true,
          complianceMarkets: true,
          complianceProfile: true,
        },
      }),
      this.prisma.providerDocument.findMany({
        where: {
          OR: [
            { relationshipId: relationship.id },
            {
              providerId: relationship.providerId,
              ownerOrgId: relationship.ownerOrgId,
            },
          ],
        },
        orderBy: { uploadedAt: 'desc' },
      }),
      this.policyService.getProviderPolicy(),
    ])

    const requirements = this.providerRequirementsService.listForScope('STATION_OWNER')
    return this.buildCompliance({
      scope: 'RELATIONSHIP',
      targetId: relationship.id,
      provider,
      relationship,
      documents: docsRaw.map(mapDocument),
      requirements,
      policy: this.policyService.normalizePolicy(policyRecord.data),
    })
  }

  async getRelationshipComplianceStatuses(relationshipIds: string[], actorId?: string) {
    const unique = Array.from(new Set(relationshipIds.filter(Boolean)))
    if (unique.length === 0) return []
    return Promise.all(unique.map((relationshipId) => this.getRelationshipComplianceStatus(relationshipId, actorId)))
  }
}
