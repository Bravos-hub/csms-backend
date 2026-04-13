import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CpoServiceType,
  Prisma,
  SitePurpose,
  StationType,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';
import { CreateSiteDocumentDto } from './dto/document.dto';
import { parsePaginationOptions } from '../../common/utils/pagination';
import {
  TenantGuardrailsService,
  TenantScope,
} from '../../common/tenant/tenant-guardrails.service';

type SiteWithRelations = Prisma.SiteGetPayload<{
  include: {
    stations: true;
    leaseDetails: true;
    documents: true;
    owner: {
      select: { id: true; name: true; email: true; phone: true; region: true };
    };
  };
}>;

@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantGuardrails: TenantGuardrailsService,
  ) {}

  private async requireTenantScope(): Promise<TenantScope> {
    return this.tenantGuardrails.requireTenantScope('tenant');
  }

  private parseArray(value?: string): string[] {
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    } catch {
      return [];
    }
  }

  private jsonArray(value?: string[]) {
    if (!value) return undefined;
    return JSON.stringify(value);
  }

  private formatSite(site: SiteWithRelations) {
    return {
      ...site,
      photos: this.parseArray(site.photos),
      amenities: this.parseArray(site.amenities),
      tags: this.parseArray(site.tags),
    };
  }

  private stationVisibilityWhere(
    scope: TenantScope,
  ): Prisma.StationWhereInput | undefined {
    if (scope.cpoType === CpoServiceType.HYBRID) {
      return undefined;
    }

    return {
      type:
        scope.cpoType === CpoServiceType.CHARGE
          ? StationType.CHARGING
          : StationType.SWAPPING,
    };
  }

  private siteInclude(scope: TenantScope): Prisma.SiteInclude {
    return {
      stations: {
        where: this.stationVisibilityWhere(scope),
      },
      leaseDetails: true,
      documents: true,
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          region: true,
        },
      },
    };
  }

  async createSite(createDto: CreateSiteDto) {
    const scope = await this.requireTenantScope();
    if (!createDto.ownerId?.trim()) {
      throw new BadRequestException('ownerId is required');
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: createDto.ownerId },
      select: { id: true, organizationId: true },
    });
    if (!owner) throw new NotFoundException('Owner not found');
    if (owner.organizationId !== scope.tenantId) {
      throw new ForbiddenException('Owner is outside tenant scope');
    }

    const data: Prisma.SiteCreateInput = {
      name: createDto.name,
      city: createDto.city,
      address: createDto.address,
      powerCapacityKw: createDto.powerCapacityKw,
      parkingBays: createDto.parkingBays,
      owner: { connect: { id: owner.id } },
      organization: { connect: { id: scope.tenantId } },
    };

    if (createDto.purpose) data.purpose = createDto.purpose;
    if (createDto.latitude !== undefined) data.latitude = createDto.latitude;
    if (createDto.longitude !== undefined) data.longitude = createDto.longitude;
    const photos = this.jsonArray(createDto.photos);
    if (photos) data.photos = photos;
    const amenities = this.jsonArray(createDto.amenities);
    if (amenities) data.amenities = amenities;
    const tags = this.jsonArray(createDto.tags);
    if (tags) data.tags = tags;

    // Handle optional lease details
    if (createDto.leaseDetails) {
      data.leaseDetails = {
        create: {
          leaseType: createDto.leaseDetails.leaseType,
          expectedFootfall: createDto.leaseDetails.expectedFootfall,
          expectedMonthlyPrice: createDto.leaseDetails.expectedMonthlyPrice,
          status: createDto.leaseDetails.status ?? 'PENDING',
        },
      };
    }

    const created = await this.prisma.site.create({
      data,
      include: { leaseDetails: true },
    });

    return this.findSiteById(created.id, scope);
  }

  private normalizePurpose(purpose?: string): SitePurpose | undefined {
    if (!purpose) return undefined;
    if (Object.values(SitePurpose).includes(purpose as SitePurpose)) {
      return purpose as SitePurpose;
    }
    throw new BadRequestException(`Invalid site purpose: ${purpose}`);
  }

  async findAllSites(
    params: { purpose?: string; limit?: string; offset?: string } = {},
  ) {
    const scope = await this.requireTenantScope();
    const purpose = this.normalizePurpose(params.purpose);
    const pagination = parsePaginationOptions(
      { limit: params.limit, offset: params.offset },
      { limit: 50, maxLimit: 200 },
    );
    const sites = await this.prisma.site.findMany({
      where: this.tenantGuardrails.buildOwnedSiteWhere(
        scope,
        purpose ? { purpose } : undefined,
      ),
      take: pagination.limit,
      skip: pagination.offset,
      include: this.siteInclude(scope),
    });
    return sites.map((site) => this.formatSite(site));
  }

  async findSiteById(id: string, scopeOverride?: TenantScope) {
    const scope = scopeOverride || (await this.requireTenantScope());
    const site = await this.prisma.site.findFirst({
      where: this.tenantGuardrails.buildOwnedSiteWhere(scope, { id }),
      include: this.siteInclude(scope),
    });
    if (!site) throw new NotFoundException('Site not found');
    return this.formatSite(site);
  }

  async updateSite(id: string, updateDto: UpdateSiteDto) {
    const scope = await this.requireTenantScope();
    const site = await this.prisma.site.findFirst({
      where: this.tenantGuardrails.buildOwnedSiteWhere(scope, { id }),
      include: { leaseDetails: true },
    });
    if (!site) throw new NotFoundException('Site not found');

    const data: Prisma.SiteUpdateInput = {};

    if (updateDto.name) data.name = updateDto.name;
    if (updateDto.city) data.city = updateDto.city;
    if (updateDto.address) data.address = updateDto.address;
    if (updateDto.powerCapacityKw !== undefined)
      data.powerCapacityKw = updateDto.powerCapacityKw;
    if (updateDto.parkingBays !== undefined)
      data.parkingBays = updateDto.parkingBays;
    if (updateDto.purpose) data.purpose = updateDto.purpose;
    if (updateDto.latitude !== undefined) data.latitude = updateDto.latitude;
    if (updateDto.longitude !== undefined) data.longitude = updateDto.longitude;
    if (updateDto.ownerId) {
      const owner = await this.prisma.user.findUnique({
        where: { id: updateDto.ownerId },
        select: { id: true, organizationId: true },
      });
      if (!owner) throw new NotFoundException('Owner not found');
      if (owner.organizationId !== scope.tenantId) {
        throw new ForbiddenException('Owner is outside tenant scope');
      }
      data.owner = { connect: { id: owner.id } };
    }

    const photos = this.jsonArray(updateDto.photos);
    if (photos) data.photos = photos;
    const amenities = this.jsonArray(updateDto.amenities);
    if (amenities) data.amenities = amenities;
    const tags = this.jsonArray(updateDto.tags);
    if (tags) data.tags = tags;

    // Handle lease details update
    if (updateDto.leaseDetails) {
      if (site.leaseDetails) {
        // Update existing lease details
        data.leaseDetails = {
          update: {
            leaseType: updateDto.leaseDetails.leaseType,
            expectedFootfall: updateDto.leaseDetails.expectedFootfall,
            expectedMonthlyPrice: updateDto.leaseDetails.expectedMonthlyPrice,
            status: updateDto.leaseDetails.status,
          },
        };
      } else {
        // Create new lease details
        data.leaseDetails = {
          create: {
            leaseType: updateDto.leaseDetails.leaseType,
            expectedFootfall: updateDto.leaseDetails.expectedFootfall,
            expectedMonthlyPrice: updateDto.leaseDetails.expectedMonthlyPrice,
            status: updateDto.leaseDetails.status ?? 'PENDING',
          },
        };
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const updated = await this.prisma.site.update({
      where: { id },
      data,
      include: this.siteInclude(scope),
    });

    return this.formatSite(updated);
  }

  async removeSite(id: string) {
    const scope = await this.requireTenantScope();
    await this.findSiteById(id, scope);
    return this.prisma.site.delete({ where: { id } });
  }

  async verifySite(id: string, status: string, verifierId: string) {
    // Verify site exists
    const scope = await this.requireTenantScope();
    await this.findSiteById(id, scope);

    return this.prisma.site.update({
      where: { id },
      data: {
        verificationStatus: status,
        documentsVerified: status === 'VERIFIED',
        documentsVerifiedAt: new Date(),
        documentsVerifiedBy: verifierId,
      },
    });
  }

  // Document Management Methods
  async findSiteDocuments(siteId: string) {
    // Verify site exists
    const scope = await this.requireTenantScope();
    await this.findSiteById(siteId, scope);

    const documents = await this.prisma.siteDocument.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
    });

    // Map database fields to frontend interface
    return documents.map((doc) => ({
      id: doc.id,
      siteId: doc.siteId,
      title: doc.name,
      fileName: doc.name,
      fileSize: doc.fileSize || 0,
      fileUrl: doc.fileUrl,
      uploadedAt: doc.createdAt.toISOString(),
      uploadedBy: doc.uploadedBy,
    }));
  }

  async createSiteDocument(siteId: string, createDto: CreateSiteDocumentDto) {
    // Verify site exists
    const scope = await this.requireTenantScope();
    await this.findSiteById(siteId, scope);

    return this.prisma.siteDocument.create({
      data: {
        siteId,
        name: createDto.name,
        type: createDto.type,
        fileUrl: createDto.fileUrl,
        fileSize: createDto.fileSize,
        mimeType: createDto.mimeType,
        uploadedBy: createDto.uploadedBy,
        description: createDto.description,
      },
    });
  }

  async deleteSiteDocument(documentId: string) {
    const scope = await this.requireTenantScope();
    const document = await this.prisma.siteDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        siteId: true,
        site: {
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.site?.organizationId !== scope.tenantId) {
      throw new ForbiddenException('Document is outside tenant scope');
    }

    return this.prisma.siteDocument.delete({
      where: { id: documentId },
    });
  }

  // Stats Aggregation Methods
  async getSiteStats(siteId: string) {
    const scope = await this.requireTenantScope();
    // Verify site exists
    await this.findSiteById(siteId, scope);

    const stations = await this.prisma.station.findMany({
      where: this.tenantGuardrails.buildOwnedStationWhere(scope, { siteId }),
      select: { id: true },
    });

    const stationIds = stations.map((station) => station.id);
    if (stationIds.length === 0) {
      return {
        totalRevenue: 0,
        totalSessions: 0,
        totalEnergy: 0,
        averageSessionDuration: undefined,
        activeSessions: 0,
        completedSessions: 0,
      };
    }

    const whereByStations: Prisma.SessionWhereInput = {
      stationId: { in: stationIds },
    };

    const [aggregate, groupedByStatus, averageRows] = await Promise.all([
      this.prisma.session.aggregate({
        where: whereByStations,
        _sum: {
          amount: true,
          totalEnergy: true,
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.session.groupBy({
        by: ['status'],
        where: whereByStations,
        _count: {
          _all: true,
        },
      }),
      this.prisma.$queryRaw<Array<{ avgMinutes: number | null }>>(Prisma.sql`
        SELECT AVG(EXTRACT(EPOCH FROM ("endTime" - "startTime")) / 60.0) AS "avgMinutes"
        FROM "sessions"
        WHERE "stationId" IN (${Prisma.join(stationIds.map((id) => Prisma.sql`${id}`))})
          AND "endTime" IS NOT NULL
          AND "status" IN ('COMPLETED', 'STOPPED')
      `),
    ]);

    const statusCount = new Map(
      groupedByStatus.map((item) => [item.status, item._count._all]),
    );
    const activeSessions = statusCount.get('ACTIVE') || 0;
    const completedSessions =
      (statusCount.get('COMPLETED') || 0) + (statusCount.get('STOPPED') || 0);
    const totalRevenue = Number(aggregate._sum.amount || 0);
    const totalEnergyWh = Number(aggregate._sum.totalEnergy || 0);
    const averageSessionDuration =
      averageRows.length > 0 && averageRows[0].avgMinutes !== null
        ? Number(averageRows[0].avgMinutes)
        : undefined;

    return {
      totalRevenue,
      totalSessions: aggregate._count._all,
      totalEnergy: totalEnergyWh / 1000,
      averageSessionDuration,
      activeSessions,
      completedSessions,
    };
  }
}
