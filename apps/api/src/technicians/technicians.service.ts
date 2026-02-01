import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TechniciansService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.technicianAvailability.findMany({
            include: {
                user: {
                    select: { id: true, name: true, phone: true },
                },
            },
            orderBy: { lastPulse: 'desc' },
        });
    }

    async updateStatus(userId: string, data: { status: string; location?: string }) {
        return this.prisma.technicianAvailability.upsert({
            where: { userId },
            update: {
                status: data.status,
                location: data.location,
                lastPulse: new Date(),
            },
            create: {
                userId,
                status: data.status,
                location: data.location,
            },
        });
    }
}
