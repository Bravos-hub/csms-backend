
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
    constructor(private prisma: PrismaService) { }

    async findAll(params: { search?: string; role?: UserRole }) {
        const where: any = {};
        if (params.search) {
            where.OR = [
                { name: { contains: params.search, mode: 'insensitive' } },
                { email: { contains: params.search, mode: 'insensitive' } },
            ];
        }
        if (params.role) {
            where.role = params.role;
        }

        return this.prisma.user.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { ownedStations: true, operatedStations: true }
                }
            }
        });
    }

    async getCrmStats() {
        const total = await this.prisma.user.count();
        const active = await this.prisma.user.count({ where: { status: 'Active' } });
        // Revenue mock (or sum transactions if possible)
        const totalRevenue = 125000;

        return {
            total,
            active,
            totalRevenue
        };
    }
}
