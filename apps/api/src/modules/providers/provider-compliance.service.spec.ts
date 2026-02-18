import { UserRole } from '@prisma/client'
import { ProviderComplianceService } from './provider-compliance.service'

describe('ProviderComplianceService', () => {
  const prisma = {
    providerRelationship: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    swapProvider: {
      findUniqueOrThrow: jest.fn(),
    },
    providerDocument: {
      findMany: jest.fn(),
    },
  } as any

  const authz = {
    getActor: jest.fn(),
    isProviderRole: jest.fn(),
    isOwnerRole: jest.fn(),
    isPlatformOps: jest.fn(),
    assertProviderScope: jest.fn(),
    assertRelationshipScopedAccess: jest.fn(),
  } as any

  const requirementsService = {
    listForScope: jest.fn(),
  } as any

  const policyService = {
    getProviderPolicy: jest.fn(),
    normalizePolicy: jest.fn(),
  } as any

  let service: ProviderComplianceService

  const defaultPolicy = {
    effectiveDateMode: 'WARN_BEFORE_ENFORCE',
    roadmapAllowedBeforeEffective: true,
    markets: ['CN', 'HK', 'FI'],
    hk: {
      dg: {
        requireConfig: true,
        thresholdKwh: null,
        class9aLabel: 'DG_CLASS_9A',
      },
    },
  }

  const baseProvider = {
    id: 'provider-1',
    standard: 'Universal',
    countries: [],
    regions: [],
    region: null,
    batteriesSupported: ['MODEL-A', 'MODEL-B'],
    complianceMarkets: [],
    complianceProfile: null,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()

    service = new ProviderComplianceService(prisma, authz, requirementsService, policyService)

    authz.getActor.mockResolvedValue({
      id: 'admin-1',
      role: UserRole.EVZONE_ADMIN,
      organizationId: null,
      providerId: null,
    })
    authz.isProviderRole.mockReturnValue(false)
    authz.isOwnerRole.mockReturnValue(false)
    authz.isPlatformOps.mockReturnValue(true)
    authz.assertRelationshipScopedAccess.mockReturnValue(undefined)

    policyService.getProviderPolicy.mockResolvedValue({ code: 'PROVIDER_COMPLIANCE_V2', data: defaultPolicy })
    policyService.normalizePolicy.mockImplementation((data: unknown) => data)
  })

  it('blocks provider when critical global document is missing', async () => {
    requirementsService.listForScope.mockReturnValue([
      {
        requirementCode: 'PRV_CORP_INCORP',
        title: 'Company registration',
        gate: 'KYB',
        category: 'CORPORATE',
        isCritical: true,
        acceptedDocTypes: ['INCORPORATION'],
        appliesTo: 'PROVIDER',
        markets: ['GLOBAL'],
      },
    ])

    prisma.swapProvider.findUniqueOrThrow.mockResolvedValue(baseProvider)
    prisma.providerDocument.findMany.mockResolvedValue([])

    const result = await service.getProviderComplianceStatus('provider-1', 'admin-1')
    expect(result.overallState).toBe('BLOCKED')
    expect(result.missingCritical).toContain('PRV_CORP_INCORP')
  })

  it('downgrades GB 38031 before effective date, then blocks on/after effective date', async () => {
    requirementsService.listForScope.mockReturnValue([
      {
        requirementCode: 'PRV_CN_GB38031_2025',
        title: 'GB 38031-2025',
        gate: 'SAFETY',
        category: 'SAFETY',
        isCritical: true,
        acceptedDocTypes: ['BATTERY_SAFETY_CERTIFICATION'],
        appliesTo: 'PROVIDER',
        markets: ['CN'],
        effectiveFrom: '2026-07-01',
        roadmapAllowedBeforeEffective: true,
      },
    ])

    prisma.swapProvider.findUniqueOrThrow.mockResolvedValue({
      ...baseProvider,
      countries: ['CN'],
    })
    prisma.providerDocument.findMany.mockResolvedValue([])

    jest.useFakeTimers().setSystemTime(new Date('2026-06-20T00:00:00.000Z'))
    const beforeEffective = await service.getProviderComplianceStatus('provider-1', 'admin-1')
    expect(beforeEffective.overallState).toBe('WARN')
    expect(beforeEffective.pendingActivation).toContain('PRV_CN_GB38031_2025')
    expect(beforeEffective.missingCritical).not.toContain('PRV_CN_GB38031_2025')

    jest.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
    const afterEffective = await service.getProviderComplianceStatus('provider-1', 'admin-1')
    expect(afterEffective.overallState).toBe('BLOCKED')
    expect(afterEffective.missingCritical).toContain('PRV_CN_GB38031_2025')
  })

  it('fails per-model requirement when one model is uncovered', async () => {
    requirementsService.listForScope.mockReturnValue([
      {
        requirementCode: 'PRV_UN38_3_REPORT',
        title: 'UN 38.3',
        gate: 'SAFETY',
        category: 'SAFETY',
        isCritical: true,
        acceptedDocTypes: ['BATTERY_SAFETY_CERTIFICATION'],
        appliesTo: 'PROVIDER',
        markets: ['GLOBAL'],
        coverageMode: 'PER_MODEL',
      },
    ])

    prisma.swapProvider.findUniqueOrThrow.mockResolvedValue(baseProvider)
    prisma.providerDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        providerId: 'provider-1',
        relationshipId: null,
        ownerOrgId: null,
        type: 'BATTERY_SAFETY_CERTIFICATION',
        requirementCode: 'PRV_UN38_3_REPORT',
        name: 'UN report',
        fileUrl: 'https://example.com/report.pdf',
        issueDate: null,
        expiryDate: null,
        coveredModels: ['MODEL-A'],
        coveredSites: [],
        uploadedAt: new Date(),
        uploadedBy: 'user-1',
        status: 'APPROVED',
        rejectionReason: null,
      },
    ])

    const result = await service.getProviderComplianceStatus('provider-1', 'admin-1')
    expect(result.overallState).toBe('BLOCKED')
    expect(result.missingCritical).toContain('PRV_UN38_3_REPORT')
  })

  it('emits HK DG policy warning when threshold is not configured', async () => {
    requirementsService.listForScope.mockReturnValue([
      {
        requirementCode: 'STN_HK_DG_APPROVAL',
        title: 'HK DG Approval',
        gate: 'SAFETY',
        category: 'SITE_PERMITS',
        isCritical: true,
        acceptedDocTypes: ['SITE_COMPATIBILITY_DECLARATION'],
        appliesTo: 'STATION_OWNER',
        markets: ['HK'],
        policyDependency: 'HK_DG_THRESHOLD',
      },
    ])

    prisma.providerRelationship.findUniqueOrThrow.mockResolvedValue({
      id: 'rel-1',
      providerId: 'provider-1',
      ownerOrgId: 'org-1',
      complianceMarkets: ['HK'],
      complianceProfile: { storedEnergyKwh: 300 },
    })
    prisma.swapProvider.findUniqueOrThrow.mockResolvedValue({
      ...baseProvider,
      complianceMarkets: ['HK'],
    })
    prisma.providerDocument.findMany.mockResolvedValue([])

    const result = await service.getRelationshipComplianceStatus('rel-1', 'admin-1')
    expect(result.policyWarnings).toContain('HK_DG_THRESHOLD_UNCONFIGURED')
    expect(result.overallState).toBe('WARN')
    expect(result.missingCritical).not.toContain('STN_HK_DG_APPROVAL')
  })

  it('blocks HK DG requirement when threshold is configured and exceeded', async () => {
    policyService.getProviderPolicy.mockResolvedValue({
      code: 'PROVIDER_COMPLIANCE_V2',
      data: {
        ...defaultPolicy,
        hk: {
          dg: {
            requireConfig: true,
            thresholdKwh: 100,
            class9aLabel: 'DG_CLASS_9A',
          },
        },
      },
    })

    requirementsService.listForScope.mockReturnValue([
      {
        requirementCode: 'STN_HK_DG_APPROVAL',
        title: 'HK DG Approval',
        gate: 'SAFETY',
        category: 'SITE_PERMITS',
        isCritical: true,
        acceptedDocTypes: ['SITE_COMPATIBILITY_DECLARATION'],
        appliesTo: 'STATION_OWNER',
        markets: ['HK'],
        policyDependency: 'HK_DG_THRESHOLD',
      },
    ])

    prisma.providerRelationship.findUniqueOrThrow.mockResolvedValue({
      id: 'rel-1',
      providerId: 'provider-1',
      ownerOrgId: 'org-1',
      complianceMarkets: ['HK'],
      complianceProfile: { storedEnergyKwh: 300 },
    })
    prisma.swapProvider.findUniqueOrThrow.mockResolvedValue({
      ...baseProvider,
      complianceMarkets: ['HK'],
    })
    prisma.providerDocument.findMany.mockResolvedValue([])

    const result = await service.getRelationshipComplianceStatus('rel-1', 'admin-1')
    expect(result.overallState).toBe('BLOCKED')
    expect(result.missingCritical).toContain('STN_HK_DG_APPROVAL')
  })
})
