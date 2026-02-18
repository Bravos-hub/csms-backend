import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { ProviderRelationshipStatus, UserRole } from '@prisma/client'
import { ProviderRelationshipsService } from './provider-relationships.service'

describe('ProviderRelationshipsService', () => {
  const prisma = {
    providerRelationship: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any

  const authz = {
    getActor: jest.fn(),
    assertOwnerOrgScope: jest.fn(),
    assertRelationshipScopedAccess: jest.fn(),
    requirePlatformOps: jest.fn(),
  } as any

  const providersService = {
    ensureProviderApproved: jest.fn(),
  } as any

  let service: ProviderRelationshipsService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ProviderRelationshipsService(prisma, authz, providersService)
  })

  it('rejects duplicate open relationship requests', async () => {
    authz.getActor.mockResolvedValue({
      id: 'user-1',
      role: UserRole.STATION_OWNER,
      organizationId: 'org-1',
      providerId: null,
    })
    providersService.ensureProviderApproved.mockResolvedValue({})
    prisma.providerRelationship.findFirst.mockResolvedValue({ id: 'existing-rel' })

    await expect(
      service.requestRelationship(
        { providerId: 'provider-1', ownerOrgId: 'org-1', notes: 'hello' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('fails approval when relationship is not in approvable state', async () => {
    authz.getActor.mockResolvedValue({
      id: 'admin-1',
      role: UserRole.EVZONE_ADMIN,
      organizationId: null,
      providerId: null,
    })
    prisma.providerRelationship.findUnique.mockResolvedValue({
      id: 'rel-1',
      providerId: 'provider-1',
      ownerOrgId: 'org-1',
      status: ProviderRelationshipStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
      requestedBy: 'user-1',
      providerRespondedAt: new Date(),
      adminApprovedAt: new Date(),
      notes: 'already active',
      provider: { id: 'provider-1', name: 'Provider 1' },
      ownerOrg: { id: 'org-1', name: 'Org 1' },
    })

    await expect(service.approveRelationship('rel-1', { notes: 'ok' }, 'admin-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    )
  })

  it('transitions REQUESTED to DOCS_PENDING on provider accept', async () => {
    authz.getActor.mockResolvedValue({
      id: 'provider-user-1',
      role: UserRole.SWAP_PROVIDER_ADMIN,
      organizationId: 'org-provider',
      providerId: 'provider-1',
    })
    prisma.providerRelationship.findUnique.mockResolvedValue({
      id: 'rel-1',
      providerId: 'provider-1',
      ownerOrgId: 'org-1',
      status: ProviderRelationshipStatus.REQUESTED,
      createdAt: new Date(),
      updatedAt: new Date(),
      requestedBy: 'user-1',
      providerRespondedAt: null,
      adminApprovedAt: null,
      notes: null,
      provider: { id: 'provider-1', name: 'Provider 1' },
      ownerOrg: { id: 'org-1', name: 'Org 1' },
    })
    prisma.providerRelationship.update.mockResolvedValue({
      id: 'rel-1',
      providerId: 'provider-1',
      ownerOrgId: 'org-1',
      status: ProviderRelationshipStatus.DOCS_PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      requestedBy: 'user-1',
      providerRespondedAt: new Date(),
      adminApprovedAt: null,
      notes: 'accepted',
      provider: { id: 'provider-1', name: 'Provider 1' },
      ownerOrg: { id: 'org-1', name: 'Org 1' },
    })

    const result = await service.respondToRelationship('rel-1', { action: 'ACCEPT', notes: 'accepted' }, 'provider-user-1')
    expect(result.status).toBe('DOCS_PENDING')
  })
})

