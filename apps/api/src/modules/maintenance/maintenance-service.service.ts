import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateIncidentDto, UpdateIncidentDto, CreateDispatchDto, CreateWebhookDto } from './dto/maintenance.dto';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }

  // Incidents
  async createIncident(dto: CreateIncidentDto) {
    return this.prisma.incident.create({
      data: {
        stationId: dto.stationId,
        chargePointId: dto.chargePointId,
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
        status: 'OPEN',
        assignedTo: dto.assignedTo
      }
    });
  }

  async findAllIncidents() {
    return this.prisma.incident.findMany({ include: { station: true } });
  }

  async findIncidentById(id: string) {
    const incident = await this.prisma.incident.findUnique({ where: { id }, include: { station: true, dispatches: true } });
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  async updateIncident(id: string, dto: UpdateIncidentDto) {
    await this.findIncidentById(id);
    return this.prisma.incident.update({
      where: { id },
      data: dto
    });
  }

  // Dispatches
  async createDispatch(dto: CreateDispatchDto) {
    return this.prisma.dispatch.create({
      data: {
        incidentId: dto.incidentId,
        technicianId: dto.technicianId,
        notes: dto.notes,
        status: 'PENDING',
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date()
      }
    });
  }

  async findAllDispatches() {
    return this.prisma.dispatch.findMany();
  }

  // Webhooks
  async registerWebhook(dto: CreateWebhookDto) {
    return this.prisma.webhook.create({
      data: {
        url: dto.url,
        events: JSON.stringify(dto.events), // Storing array as string simplified for now if schema expects string
        secret: dto.secret,
        active: true
      }
    });
  }

  async getWebhooks() {
    return this.prisma.webhook.findMany();
  }
}
