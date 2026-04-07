import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(siteId?: string) {
    const where: Prisma.SiteTenantWhereInput = {};
    if (siteId) where.siteId = siteId;

    return this.prisma.siteTenant.findMany({
      where,
      include: {
        site: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });
  }
}
