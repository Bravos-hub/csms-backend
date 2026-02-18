import { UserRole } from '@prisma/client'
import { ProviderSettlementsService } from './provider-settlements.service'

describe('ProviderSettlementsService', () => {
  const prisma = {
    providerSettlementEntry: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    providerRelationship: {
      findUnique: jest.fn(),
    },
  } as any

  const authz = {
    getActor: jest.fn(),
    isProviderRole: jest.fn(),
    isOwnerRole: jest.fn(),
    isPlatformOps: jest.fn(),
    requirePlatformOps: jest.fn(),
  } as any

  let service: ProviderSettlementsService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ProviderSettlementsService(prisma, authz)
  })

  it('aggregates settlement totals correctly', async () => {
    authz.getActor.mockResolvedValue({
      id: 'admin-1',
      role: UserRole.EVZONE_ADMIN,
      organizationId: null,
      providerId: null,
    })
    authz.isPlatformOps.mockReturnValue(true)

    prisma.providerSettlementEntry.findMany.mockResolvedValue([
      {
        id: 'row-1',
        relationshipId: 'rel-1',
        providerId: 'provider-1',
        ownerOrgId: 'org-1',
        stationId: 'station-1',
        sessionId: 'session-1',
        amount: 100,
        providerFee: 10,
        platformFee: 5,
        adjustment: 0,
        net: 85,
        currency: 'USD',
        status: 'PAID',
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        updatedAt: new Date('2026-01-10T00:00:00.000Z'),
      },
      {
        id: 'row-2',
        relationshipId: 'rel-1',
        providerId: 'provider-1',
        ownerOrgId: 'org-1',
        stationId: 'station-1',
        sessionId: 'session-2',
        amount: 200,
        providerFee: 20,
        platformFee: 10,
        adjustment: -5,
        net: 165,
        currency: 'USD',
        status: 'PENDING',
        createdAt: new Date('2026-01-11T00:00:00.000Z'),
        updatedAt: new Date('2026-01-11T00:00:00.000Z'),
      },
    ])

    const summary = await service.getSummary({}, 'admin-1')
    expect(summary.totals.gross).toBe(300)
    expect(summary.totals.providerFee).toBe(30)
    expect(summary.totals.platformFee).toBe(15)
    expect(summary.totals.adjustments).toBe(-5)
    expect(summary.totals.receivables).toBe(250)
    expect(summary.totals.paid).toBe(85)
    expect(summary.totals.pending).toBe(165)
    expect(summary.totals.netPayable).toBe(165)
  })
})

