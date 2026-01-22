import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';
import { CreateSiteDocumentDto } from './dto/document.dto';

type SiteWithRelations = Prisma.SiteGetPayload<{ include: { stations: true; leaseDetails: true; documents: true } }>;


@Injectable()
export class SiteService {
  constructor(private readonly prisma: PrismaService) { }

  private parseArray(value?: string) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
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

  async createSite(createDto: CreateSiteDto) {
    if (!createDto.ownerId?.trim()) {
      throw new BadRequestException('ownerId is required');
    }

    const owner = await this.prisma.user.findUnique({ where: { id: createDto.ownerId } });
    if (!owner) throw new NotFoundException('Owner not found');

    const data: Prisma.SiteCreateInput = {
      name: createDto.name,
      city: createDto.city,
      address: createDto.address,
      powerCapacityKw: createDto.powerCapacityKw,
      parkingBays: createDto.parkingBays,
      owner: { connect: { id: owner.id } },
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
        }
      };
    }

    const created = await this.prisma.site.create({
      data,
      include: { stations: true, leaseDetails: true, documents: true }
    });


    return this.findSiteById(created.id);
  }

  async findAllSites() {
    const sites = await this.prisma.site.findMany({
      include: { stations: true, leaseDetails: true, documents: true }
    });
    return sites.map((site) => this.formatSite(site));
  }

  async findSiteById(id: string) {
    const site = await this.prisma.site.findUnique({
      where: { id },
      include: { stations: true, leaseDetails: true, documents: true }
    });
    if (!site) throw new NotFoundException('Site not found');
    return this.formatSite(site);
  }

  async updateSite(id: string, updateDto: UpdateSiteDto) {
    const site = await this.prisma.site.findUnique({
      where: { id },
      include: { leaseDetails: true }
    });
    if (!site) throw new NotFoundException('Site not found');

    const data: Prisma.SiteUpdateInput = {};

    if (updateDto.name) data.name = updateDto.name;
    if (updateDto.city) data.city = updateDto.city;
    if (updateDto.address) data.address = updateDto.address;
    if (updateDto.powerCapacityKw !== undefined) data.powerCapacityKw = updateDto.powerCapacityKw;
    if (updateDto.parkingBays !== undefined) data.parkingBays = updateDto.parkingBays;
    if (updateDto.purpose) data.purpose = updateDto.purpose;
    if (updateDto.latitude !== undefined) data.latitude = updateDto.latitude;
    if (updateDto.longitude !== undefined) data.longitude = updateDto.longitude;
    if (updateDto.ownerId) {
      const owner = await this.prisma.user.findUnique({ where: { id: updateDto.ownerId } });
      if (!owner) throw new NotFoundException('Owner not found');
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
          }
        };
      } else {
        // Create new lease details
        data.leaseDetails = {
          create: {
            leaseType: updateDto.leaseDetails.leaseType,
            expectedFootfall: updateDto.leaseDetails.expectedFootfall,
            expectedMonthlyPrice: updateDto.leaseDetails.expectedMonthlyPrice,
            status: updateDto.leaseDetails.status ?? 'PENDING',
          }
        };
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const updated = await this.prisma.site.update({
      where: { id },
      data,
      include: { stations: true, leaseDetails: true, documents: true }
    });


    return this.formatSite(updated);
  }

  async removeSite(id: string) {
    await this.findSiteById(id);
    return this.prisma.site.delete({ where: { id } });
  }

  async verifySite(id: string, status: string, verifierId: string) {
    // Verify site exists
    await this.findSiteById(id);

    return this.prisma.site.update({
      where: { id },
      data: {
        verificationStatus: status,
        documentsVerified: status === 'VERIFIED',
        documentsVerifiedAt: new Date(),
        documentsVerifiedBy: verifierId
      }
    });
  }

  // Document Management Methods
  async findSiteDocuments(siteId: string) {
    // Verify site exists
    await this.findSiteById(siteId);

    const documents = await this.prisma.siteDocument.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' }
    });

    // Map database fields to frontend interface
    return documents.map(doc => ({
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
    await this.findSiteById(siteId);

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
      }
    });
  }

  async deleteSiteDocument(documentId: string) {
    const document = await this.prisma.siteDocument.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return this.prisma.siteDocument.delete({
      where: { id: documentId }
    });
  }

  // Stats Aggregation Methods
  async getSiteStats(siteId: string) {
    // Verify site exists
    await this.findSiteById(siteId);

    // Get all stations for this site with their charge points and sessions
    // Flow: Site ID → Find ChargePoints → Find Sessions → Aggregate Stats
    const stations = await this.prisma.station.findMany({
      where: { siteId },
      include: {
        chargePoints: {
          include: {
            sessions: true
          }
        }
      }
    });

    // Collect all sessions from all charge points at this site
    const allSessions = [];
    for (const station of stations) {
      for (const chargePoint of station.chargePoints) {
        allSessions.push(...chargePoint.sessions);
      }
    }

    // Initialize aggregated stats
    let totalRevenue = 0;
    let totalEnergy = 0; // in kWh
    let activeSessions = 0;
    let completedSessions = 0;
    let totalDurationMinutes = 0;
    let completedSessionsCount = 0;

    // Aggregate stats from all sessions
    for (const session of allSessions) {
      // 1. Total Revenue - Sum of all session.amount values
      totalRevenue += session.amount || 0;

      // 2. Total Energy - Sum of all energy in kWh (convert from Wh)
      const energyKwh = session.totalEnergy / 1000;
      totalEnergy += energyKwh;

      // Count sessions by status
      if (session.status === 'ACTIVE') {
        activeSessions++;
      } else if (session.status === 'COMPLETED' || session.status === 'STOPPED') {
        completedSessions++;

        // 4. Calculate session duration for completed sessions
        if (session.endTime) {
          const durationMs = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
          const durationMinutes = durationMs / (1000 * 60);
          totalDurationMinutes += durationMinutes;
          completedSessionsCount++;
        }
      }
    }

    // Calculate average session duration
    const averageSessionDuration = completedSessionsCount > 0
      ? totalDurationMinutes / completedSessionsCount
      : undefined;

    return {
      totalRevenue,
      totalSessions: allSessions.length,
      totalEnergy,
      averageSessionDuration,
      activeSessions,
      completedSessions
    };
  }

}
