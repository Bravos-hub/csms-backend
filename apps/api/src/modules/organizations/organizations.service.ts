import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class OrganizationsService {
    private readonly logger = new Logger(OrganizationsService.name);

    constructor(private readonly prisma: PrismaService) { }

    async findOne(id: string) {
        const org = await this.prisma.organization.findUnique({
            where: { id },
            include: { users: true }
        });
        if (!org) throw new NotFoundException('Organization not found');
        return org;
    }

    async update(id: string, data: any) {
        return this.prisma.organization.update({
            where: { id },
            data
        });
    }

    async setupPayouts(id: string, payoutData: { provider: string; walletNumber: string; taxId?: string }) {
        return this.prisma.organization.update({
            where: { id },
            data: {
                paymentProvider: payoutData.provider,
                walletNumber: payoutData.walletNumber,
                taxId: payoutData.taxId
            }
        });
    }

    async uploadLogo(id: string, logoUrl: string) {
        return this.prisma.organization.update({
            where: { id },
            data: { logoUrl }
        });
    }
}
