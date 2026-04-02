import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { users: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, data: unknown) {
    if (!this.isObject(data)) {
      throw new BadRequestException('Invalid organization update payload');
    }

    const updateData = data as Prisma.OrganizationUpdateInput;
    return this.prisma.organization.update({
      where: { id },
      data: updateData,
    });
  }

  async setupPayouts(
    id: string,
    payoutData: { provider: string; walletNumber: string; taxId?: string },
  ) {
    return this.prisma.organization.update({
      where: { id },
      data: {
        paymentProvider: payoutData.provider,
        walletNumber: payoutData.walletNumber,
        taxId: payoutData.taxId,
      },
    });
  }

  async uploadLogo(id: string, logoUrl: string) {
    return this.prisma.organization.update({
      where: { id },
      data: { logoUrl },
    });
  }
}
