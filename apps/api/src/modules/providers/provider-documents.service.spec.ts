import { BadRequestException } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { ProviderDocumentsService } from './provider-documents.service'

describe('ProviderDocumentsService', () => {
  const prisma = {
    providerDocument: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any

  const authz = {
    getActor: jest.fn(),
    requirePlatformOps: jest.fn(),
  } as any

  let service: ProviderDocumentsService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ProviderDocumentsService(prisma, authz)
  })

  it('requires reason/notes for rejected reviews', async () => {
    authz.getActor.mockResolvedValue({
      id: 'admin-1',
      role: UserRole.EVZONE_ADMIN,
      organizationId: null,
      providerId: null,
    })
    prisma.providerDocument.findUnique.mockResolvedValue({
      id: 'doc-1',
      providerId: 'provider-1',
      relationshipId: null,
      ownerOrgId: null,
      type: 'INCORPORATION',
      name: 'Cert',
      fileUrl: 'https://example.com/doc.pdf',
      uploadedAt: new Date(),
      uploadedBy: 'user-1',
      status: 'PENDING',
      rejectionReason: null,
    })

    await expect(
      service.reviewDocument(
        'doc-1',
        {
          status: 'REJECTED',
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('updates document review status', async () => {
    authz.getActor.mockResolvedValue({
      id: 'admin-1',
      role: UserRole.EVZONE_ADMIN,
      organizationId: null,
      providerId: null,
    })
    prisma.providerDocument.findUnique.mockResolvedValue({
      id: 'doc-1',
      providerId: 'provider-1',
      relationshipId: null,
      ownerOrgId: null,
      type: 'INCORPORATION',
      name: 'Cert',
      fileUrl: 'https://example.com/doc.pdf',
      uploadedAt: new Date(),
      uploadedBy: 'user-1',
      status: 'PENDING',
      rejectionReason: null,
    })
    prisma.providerDocument.update.mockResolvedValue({
      id: 'doc-1',
      providerId: 'provider-1',
      relationshipId: null,
      ownerOrgId: null,
      type: 'INCORPORATION',
      name: 'Cert',
      fileUrl: 'https://example.com/doc.pdf',
      uploadedAt: new Date(),
      uploadedBy: 'user-1',
      status: 'APPROVED',
      rejectionReason: null,
      relationship: null,
    })

    const reviewed = await service.reviewDocument(
      'doc-1',
      {
        status: 'APPROVED',
      },
      'admin-1',
    )

    expect(reviewed.status).toBe('APPROVED')
    expect(prisma.providerDocument.update).toHaveBeenCalled()
  })
})

