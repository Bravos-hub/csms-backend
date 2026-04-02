import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export type IncidentQuery = {
  status?: string;
  severity?: string;
  stationId?: string;
};

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(query: IncidentQuery) {
    const where: Record<string, unknown> = {};

    if (query.status?.trim()) {
      where.status = query.status.trim();
    }
    if (query.severity?.trim()) {
      where.severity = query.severity.trim();
    }
    if (query.stationId?.trim()) {
      where.stationId = query.stationId.trim();
    }

    return this.prisma.incident.findMany({
      where,
      include: {
        station: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getById(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        station: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!incident) {
      throw new NotFoundException('Incident not found');
    }

    return incident;
  }

  async create(payload: Record<string, unknown>) {
    const stationId = this.toOptionalString(payload.stationId) || '';
    const chargePointId = this.toOptionalString(payload.chargePointId);
    const title =
      this.toOptionalString(payload.title) ||
      this.toOptionalString(payload.description) ||
      'Incident';
    const description =
      this.toOptionalString(payload.description) ||
      this.toOptionalString(payload.title) ||
      'Incident';
    const severity = this.toOptionalString(payload.severity) || 'LOW';
    const status = this.toOptionalString(payload.status) || 'OPEN';
    const assignedTo = this.toOptionalString(payload.assignedTo);

    return this.prisma.incident.create({
      data: {
        stationId,
        chargePointId: chargePointId || null,
        title,
        description,
        severity,
        status,
        assignedTo: assignedTo || null,
      },
    });
  }

  async update(id: string, payload: Record<string, unknown>) {
    await this.getById(id);

    return this.prisma.incident.update({
      where: { id },
      data: {
        chargePointId:
          payload.chargePointId === undefined
            ? undefined
            : this.toOptionalString(payload.chargePointId) || null,
        title:
          payload.title === undefined
            ? undefined
            : this.toOptionalString(payload.title),
        description:
          payload.description === undefined
            ? undefined
            : this.toOptionalString(payload.description),
        severity:
          payload.severity === undefined
            ? undefined
            : this.toOptionalString(payload.severity),
        status:
          payload.status === undefined
            ? undefined
            : this.toOptionalString(payload.status),
        assignedTo:
          payload.assignedTo === undefined
            ? undefined
            : this.toOptionalString(payload.assignedTo) || null,
      },
    });
  }

  async remove(id: string) {
    await this.getById(id);
    return this.prisma.incident.delete({ where: { id } });
  }

  private toOptionalString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    return undefined;
  }
}
