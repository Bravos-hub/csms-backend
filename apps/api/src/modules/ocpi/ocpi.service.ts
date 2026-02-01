
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class OcpiService {
    constructor(private prisma: PrismaService) { }

    async findAllPartners() {
        return this.prisma.ocpiPartner.findMany({
            orderBy: { createdAt: 'desc' },
        });
    }

    async getRoamingSessions() {
        // We can fetch from OcpiPartnerSession or Transaction if mapped.
        // Assuming OcpiPartnerSession stores the roaming sessions.
        return this.prisma.ocpiPartnerSession.findMany({
            include: {
                // Add relations if needed, but schema didn't show explicit relations on this model
            },
            orderBy: { lastUpdated: 'desc' },
            take: 100, // Limit for now
        });
    }

    async getRoamingCdrs() {
        return this.prisma.ocpiPartnerCdr.findMany({
            orderBy: { lastUpdated: 'desc' },
            take: 100
        })
    }
}
