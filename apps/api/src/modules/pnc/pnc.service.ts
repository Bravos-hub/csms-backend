import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { MembershipStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  CreatePncContractDto,
  IssuePncCertificateDto,
  PncListContractsQueryDto,
  RevokePncCertificateDto,
  UpdatePncContractDto,
} from './dto/pnc.dto';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const CONTRACT_STATUS = new Set(['ACTIVE', 'SUSPENDED', 'REVOKED']);
const CERTIFICATE_TYPE = new Set(['CONTRACT', 'PROVISIONING', 'ROOT']);

@Injectable()
export class PncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getOverview(actorId: string): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const now = new Date();
    const expiryWindowEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [
      contractCount,
      activeContractCount,
      certificateCount,
      activeCertificates,
      expiringCertificates,
      contracts,
    ] = await Promise.all([
      this.prisma.pncContract.count({
        where: { organizationId: tenantId },
      }),
      this.prisma.pncContract.count({
        where: { organizationId: tenantId, status: 'ACTIVE' },
      }),
      this.prisma.pncContractCertificate.count({
        where: { organizationId: tenantId },
      }),
      this.prisma.pncContractCertificate.count({
        where: {
          organizationId: tenantId,
          status: 'ACTIVE',
        },
      }),
      this.prisma.pncContractCertificate.count({
        where: {
          organizationId: tenantId,
          status: 'ACTIVE',
          validTo: {
            gte: now,
            lte: expiryWindowEnd,
          },
        },
      }),
      this.prisma.pncContract.findMany({
        where: { organizationId: tenantId },
        include: {
          certificates: {
            orderBy: [{ updatedAt: 'desc' }],
            take: 5,
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 25,
      }),
    ]);

    const flattenedCertificates = contracts
      .flatMap((contract) => contract.certificates)
      .sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
      )
      .slice(0, 50)
      .map((certificate) => this.toCertificateSummary(certificate));

    return {
      metrics: {
        contractCount,
        activeContractCount,
        certificateCount,
        activeCertificates,
        expiringCertificates,
      },
      contracts: contracts.map((contract) => ({
        ...contract,
        certificates: contract.certificates.map((certificate) =>
          this.toCertificateSummary(certificate),
        ),
      })),
      certificates: flattenedCertificates,
      note: 'Plug & Charge contract certificates are tenant-scoped and fully auditable.',
    };
  }

  async listContracts(
    actorId: string,
    query: PncListContractsQueryDto,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const search = this.optionalTrimmed(query.search);
    const status = this.normalizeOptionalStatus(query.status, CONTRACT_STATUS);

    return this.prisma.pncContract.findMany({
      where: {
        organizationId: tenantId,
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { contractRef: { contains: search, mode: 'insensitive' } },
                {
                  eMobilityAccountId: { contains: search, mode: 'insensitive' },
                },
                { providerPartyId: { contains: search, mode: 'insensitive' } },
                { vehicleVin: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        certificates: {
          orderBy: [{ updatedAt: 'desc' }],
          take: 10,
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async createContract(
    actorId: string,
    dto: CreatePncContractDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const contractRef = this.requiredTrimmed(dto.contractRef, 'contractRef');

    try {
      return await this.prisma.pncContract.create({
        data: {
          organizationId: tenantId,
          contractRef,
          eMobilityAccountId: this.optionalTrimmed(dto.eMobilityAccountId),
          providerPartyId: this.optionalTrimmed(dto.providerPartyId),
          vehicleVin: this.optionalTrimmed(dto.vehicleVin),
          status:
            this.normalizeOptionalStatus(dto.status, CONTRACT_STATUS) ||
            'ACTIVE',
          metadata: this.normalizeMetadata(dto.metadata),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    } catch (error) {
      this.handleKnownPrismaError(
        error,
        'PnC contract reference already exists for this tenant',
      );
      throw error;
    }
  }

  async updateContract(
    actorId: string,
    contractId: string,
    dto: UpdatePncContractDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    await this.assertContractInTenant(contractId, tenantId);

    return this.prisma.pncContract.update({
      where: { id: contractId },
      data: {
        ...(dto.eMobilityAccountId !== undefined
          ? {
              eMobilityAccountId: this.optionalTrimmed(dto.eMobilityAccountId),
            }
          : {}),
        ...(dto.providerPartyId !== undefined
          ? { providerPartyId: this.optionalTrimmed(dto.providerPartyId) }
          : {}),
        ...(dto.vehicleVin !== undefined
          ? { vehicleVin: this.optionalTrimmed(dto.vehicleVin) }
          : {}),
        ...(dto.status !== undefined
          ? {
              status:
                this.normalizeOptionalStatus(dto.status, CONTRACT_STATUS) ||
                'ACTIVE',
            }
          : {}),
        ...(dto.metadata !== undefined
          ? { metadata: this.normalizeMetadata(dto.metadata) }
          : {}),
        updatedBy: actorId,
      },
    });
  }

  async issueCertificate(
    actorId: string,
    contractId: string,
    dto: IssuePncCertificateDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    const contract = await this.assertContractInTenant(contractId, tenantId);
    const certificateHash = this.normalizeCertificateHash(dto.certificateHash);
    const mappedChargePointIds = await this.validateMappedChargePointIds(
      tenantId,
      dto.mappedChargePointIds,
    );
    const validFrom = this.optionalDate(dto.validFrom, 'validFrom');
    const validTo = this.optionalDate(dto.validTo, 'validTo');
    if (validFrom && validTo && validTo.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('validTo must be after validFrom');
    }

    let certificateId = '';

    try {
      const certificate = await this.prisma.pncContractCertificate.create({
        data: {
          contractId: contract.id,
          organizationId: tenantId,
          certificateHash,
          certificateType:
            this.normalizeOptionalStatus(
              dto.certificateType,
              CERTIFICATE_TYPE,
            ) || 'CONTRACT',
          status: 'ACTIVE',
          validFrom,
          validTo,
          mappedChargePointIds:
            mappedChargePointIds.length > 0
              ? (mappedChargePointIds as Prisma.InputJsonValue)
              : undefined,
          diagnostics: this.normalizeMetadata(dto.diagnostics),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      certificateId = certificate.id;
    } catch (error) {
      this.handleKnownPrismaError(
        error,
        'Certificate hash already exists for this tenant',
      );
      throw error;
    }

    await this.recordCertificateEvent({
      certificateId,
      tenantId,
      actorId,
      eventType: 'ISSUED',
      status: 'ACTIVE',
      details: {
        contractId,
        mappedChargePointCount: mappedChargePointIds.length,
      },
    });

    return this.getCertificateDiagnostics(actorId, certificateId);
  }

  async revokeCertificate(
    actorId: string,
    certificateId: string,
    dto: RevokePncCertificateDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    const certificate = await this.assertCertificateInTenant(
      certificateId,
      tenantId,
    );
    const reason = this.optionalTrimmed(dto.reason) || 'Operator initiated';

    await this.prisma.pncContractCertificate.update({
      where: { id: certificate.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: reason,
        updatedBy: actorId,
      },
    });

    await this.recordCertificateEvent({
      certificateId: certificate.id,
      tenantId,
      actorId,
      eventType: 'REVOKED',
      status: 'REVOKED',
      details: { reason },
    });

    return this.getCertificateDiagnostics(actorId, certificate.id);
  }

  async getCertificateDiagnostics(
    actorId: string,
    certificateId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const certificate = await this.prisma.pncContractCertificate.findUnique({
      where: { id: certificateId },
      include: {
        contract: {
          select: {
            id: true,
            contractRef: true,
            status: true,
          },
        },
        events: {
          orderBy: [{ occurredAt: 'desc' }],
          take: 50,
        },
      },
    });
    if (!certificate || certificate.organizationId !== tenantId) {
      throw new NotFoundException('PnC certificate not found');
    }

    const now = Date.now();
    const validToMs = certificate.validTo?.getTime() ?? null;
    const isExpired = validToMs !== null ? validToMs < now : false;
    const daysToExpiry =
      validToMs === null
        ? null
        : Math.floor((validToMs - now) / (24 * 60 * 60 * 1000));
    const mappedChargePointIds = this.normalizeJsonStringArray(
      certificate.mappedChargePointIds,
    );

    return {
      certificate: this.toCertificateSummary(certificate),
      contract: certificate.contract,
      diagnostics: {
        status: certificate.status,
        isExpired,
        daysToExpiry,
        mappedChargePointCount: mappedChargePointIds.length,
        revocationReason: certificate.revocationReason,
      },
      mappedChargePointIds,
      events: certificate.events,
    };
  }

  private async recordCertificateEvent(input: {
    certificateId: string;
    tenantId: string;
    actorId: string;
    eventType: string;
    status?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.pncCertificateEvent.create({
      data: {
        certificateId: input.certificateId,
        organizationId: input.tenantId,
        eventType: input.eventType,
        status: input.status || null,
        details: this.normalizeMetadata(input.details),
        createdBy: input.actorId,
      },
    });
  }

  private toCertificateSummary(certificate: {
    id: string;
    certificateHash: string;
    certificateType: string;
    status: string;
    validFrom: Date | null;
    validTo: Date | null;
    revokedAt: Date | null;
    revocationReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    mappedChargePointIds: Prisma.JsonValue | null;
  }): Record<string, unknown> {
    return {
      id: certificate.id,
      certificateHash: certificate.certificateHash,
      certificateType: certificate.certificateType,
      status: certificate.status,
      validFrom: certificate.validFrom?.toISOString() || null,
      validTo: certificate.validTo?.toISOString() || null,
      revokedAt: certificate.revokedAt?.toISOString() || null,
      revocationReason: certificate.revocationReason,
      mappedChargePointIds: this.normalizeJsonStringArray(
        certificate.mappedChargePointIds,
      ),
      createdAt: certificate.createdAt.toISOString(),
      updatedAt: certificate.updatedAt.toISOString(),
    };
  }

  private resolveTenantId(): string {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId || context?.authenticatedOrganizationId;
    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant context is required for PnC operations',
      );
    }
    return tenantId;
  }

  private requiredTrimmed(value: string, field: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }
    return trimmed;
  }

  private optionalTrimmed(value?: string): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private optionalDate(value: string | undefined, field: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO date`);
    }
    return parsed;
  }

  private normalizeMetadata(
    value?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!value) return undefined;
    return value as Prisma.InputJsonValue;
  }

  private normalizeCertificateHash(value: string): string {
    const normalized = value
      .replace(/[\s:]+/g, '')
      .trim()
      .toUpperCase();
    if (normalized.length < 32 || normalized.length > 256) {
      throw new BadRequestException(
        'certificateHash must be a normalized fingerprint/hash string',
      );
    }
    return normalized;
  }

  private normalizeOptionalStatus(
    value: string | undefined,
    allowed: ReadonlySet<string>,
  ): string | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase();
    if (!allowed.has(normalized)) {
      throw new BadRequestException(
        `Invalid value "${value}". Allowed values: ${Array.from(allowed).join(', ')}`,
      );
    }
    return normalized;
  }

  private normalizeJsonStringArray(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  private async assertTenantActor(
    actorId: string,
    tenantId: string,
  ): Promise<void> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const controlPlane = this.prisma.getControlPlaneClient();

    const [user, membership] = await Promise.all([
      controlPlane.user.findUnique({
        where: { id: normalizedActorId },
        select: { role: true },
      }),
      controlPlane.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: normalizedActorId,
            organizationId: tenantId,
          },
        },
        select: { status: true },
      }),
    ]);

    if (!user) {
      throw new ForbiddenException('Authenticated user is not recognized');
    }

    const isPlatformAdmin = PLATFORM_ADMIN_ROLES.has(user.role);
    if (!isPlatformAdmin && membership?.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(
        'User must be an active tenant member for PnC operations',
      );
    }
  }

  private async assertContractInTenant(
    contractId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    organizationId: string;
  }> {
    const contract = await this.prisma.pncContract.findUnique({
      where: { id: contractId },
      select: { id: true, organizationId: true },
    });
    if (!contract || contract.organizationId !== tenantId) {
      throw new NotFoundException('PnC contract not found');
    }
    return contract;
  }

  private async assertCertificateInTenant(
    certificateId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    organizationId: string;
  }> {
    const certificate = await this.prisma.pncContractCertificate.findUnique({
      where: { id: certificateId },
      select: { id: true, organizationId: true },
    });
    if (!certificate || certificate.organizationId !== tenantId) {
      throw new NotFoundException('PnC certificate not found');
    }
    return certificate;
  }

  private async validateMappedChargePointIds(
    tenantId: string,
    value?: string[],
  ): Promise<string[]> {
    if (!Array.isArray(value) || value.length === 0) {
      return [];
    }

    const normalizedIds = Array.from(
      new Set(
        value.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
      ),
    );
    if (normalizedIds.length === 0) {
      return [];
    }
    if (normalizedIds.length > 200) {
      throw new BadRequestException(
        'mappedChargePointIds cannot contain more than 200 entries',
      );
    }

    const chargePoints = await this.prisma.chargePoint.findMany({
      where: {
        id: { in: normalizedIds },
      },
      select: {
        id: true,
        station: {
          select: {
            orgId: true,
            site: {
              select: {
                organizationId: true,
              },
            },
          },
        },
      },
    });

    const byId = new Map(chargePoints.map((entry) => [entry.id, entry]));
    for (const chargePointId of normalizedIds) {
      const chargePoint = byId.get(chargePointId);
      if (!chargePoint) {
        throw new BadRequestException(
          `Mapped charge point ${chargePointId} does not exist`,
        );
      }
      const ownerTenant =
        chargePoint.station.orgId || chargePoint.station.site?.organizationId;
      if (ownerTenant && ownerTenant !== tenantId) {
        throw new BadRequestException(
          `Mapped charge point ${chargePointId} is outside tenant scope`,
        );
      }
    }

    return normalizedIds;
  }

  private handleKnownPrismaError(error: unknown, message: string): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
  }
}
