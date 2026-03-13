import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

type IncidentQuery = {
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
    return this.prisma.incident.create({
      data: {
        stationId: String(payload.stationId || ''),
        chargePointId: payload.chargePointId
          ? String(payload.chargePointId)
          : null,
        title: String(payload.title || payload.description || 'Incident'),
        description: String(payload.description || payload.title || 'Incident'),
        severity: String(payload.severity || 'LOW'),
        status: String(payload.status || 'OPEN'),
        assignedTo: payload.assignedTo ? String(payload.assignedTo) : null,
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
            : payload.chargePointId
              ? String(payload.chargePointId)
              : null,
        title: payload.title === undefined ? undefined : String(payload.title),
        description:
          payload.description === undefined
            ? undefined
            : String(payload.description),
        severity:
          payload.severity === undefined ? undefined : String(payload.severity),
        status:
          payload.status === undefined ? undefined : String(payload.status),
        assignedTo:
          payload.assignedTo === undefined
            ? undefined
            : payload.assignedTo
              ? String(payload.assignedTo)
              : null,
      },
    });
  }

  async remove(id: string) {
    await this.getById(id);
    return this.prisma.incident.delete({ where: { id } });
  }
}
