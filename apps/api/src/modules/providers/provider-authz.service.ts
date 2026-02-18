import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { PrismaService } from '../../prisma.service'

export type ProviderActor = {
  id: string
  role: UserRole
  organizationId: string | null
  providerId: string | null
}

@Injectable()
export class ProviderAuthzService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly platformOpsRoles = new Set<UserRole>([
    UserRole.SUPER_ADMIN,
    UserRole.EVZONE_ADMIN,
    UserRole.EVZONE_OPERATOR,
  ])

  private readonly providerRoles = new Set<UserRole>([
    UserRole.SWAP_PROVIDER_ADMIN,
    UserRole.SWAP_PROVIDER_OPERATOR,
  ])

  private readonly ownerRoles = new Set<UserRole>([UserRole.STATION_OWNER, UserRole.STATION_OPERATOR])

  async getActor(userId?: string): Promise<ProviderActor> {
    if (!userId) throw new UnauthorizedException('Missing authenticated user context')
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, organizationId: true, providerId: true },
    })
    if (!actor) throw new NotFoundException('Authenticated user not found')
    return actor
  }

  isPlatformOps(role: UserRole): boolean {
    return this.platformOpsRoles.has(role)
  }

  isProviderRole(role: UserRole): boolean {
    return this.providerRoles.has(role)
  }

  isOwnerRole(role: UserRole): boolean {
    return this.ownerRoles.has(role)
  }

  requirePlatformOps(actor: ProviderActor) {
    if (!this.isPlatformOps(actor.role)) {
      throw new ForbiddenException('This action is restricted to platform operations roles')
    }
  }

  requireProviderRole(actor: ProviderActor) {
    if (!this.isProviderRole(actor.role)) {
      throw new ForbiddenException('This action is restricted to provider roles')
    }
  }

  resolveOwnerOrgScope(actor: ProviderActor, requestedOwnerOrgId?: string): string {
    if (this.isPlatformOps(actor.role)) {
      if (!requestedOwnerOrgId) {
        throw new BadRequestException('ownerOrgId is required for this request')
      }
      return requestedOwnerOrgId
    }

    if (!actor.organizationId) {
      throw new BadRequestException('Authenticated user has no organizationId')
    }

    if (requestedOwnerOrgId && requestedOwnerOrgId !== actor.organizationId) {
      throw new ForbiddenException('ownerOrgId does not match your authenticated organization scope')
    }

    if (!this.isOwnerRole(actor.role)) {
      throw new ForbiddenException('Only station owner/operator users can act on owner organization scope')
    }

    return actor.organizationId
  }

  assertProviderScope(actor: ProviderActor, providerId: string) {
    if (this.isPlatformOps(actor.role)) return
    if (!this.isProviderRole(actor.role)) {
      throw new ForbiddenException('Only platform ops or provider users can perform this action')
    }
    if (!actor.providerId || actor.providerId !== providerId) {
      throw new ForbiddenException('Requested provider is outside your authenticated scope')
    }
  }

  assertOwnerOrgScope(actor: ProviderActor, ownerOrgId: string) {
    if (this.isPlatformOps(actor.role)) return
    if (!this.isOwnerRole(actor.role)) {
      throw new ForbiddenException('Only station owner/operator users can perform this action')
    }
    if (!actor.organizationId || actor.organizationId !== ownerOrgId) {
      throw new ForbiddenException('Requested owner organization is outside your authenticated scope')
    }
  }

  assertRelationshipScopedAccess(actor: ProviderActor, relationship: { providerId: string; ownerOrgId: string }) {
    if (this.isPlatformOps(actor.role)) return
    if (this.isProviderRole(actor.role) && actor.providerId === relationship.providerId) return
    if (this.isOwnerRole(actor.role) && actor.organizationId === relationship.ownerOrgId) return
    throw new ForbiddenException('Relationship is outside your authenticated scope')
  }
}

