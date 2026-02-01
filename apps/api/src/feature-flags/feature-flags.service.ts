import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class FeatureFlagsService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.featureFlag.findMany();
    }

    async create(data: { key: string; description?: string; isEnabled?: boolean; rules?: any }) {
        return this.prisma.featureFlag.create({
            data: {
                key: data.key,
                description: data.description,
                isEnabled: data.isEnabled ?? false,
                rules: data.rules ?? {},
            },
        });
    }

    async update(key: string, data: { isEnabled?: boolean; rules?: any }) {
        return this.prisma.featureFlag.update({
            where: { key },
            data,
        });
    }

    async isEnabled(key: string, context?: any): Promise<boolean> {
        const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
        if (!flag) return false;
        if (!flag.isEnabled) return false;

        // Future: Evaluate rules based on context (user, region, etc.)
        return true;
    }
}
