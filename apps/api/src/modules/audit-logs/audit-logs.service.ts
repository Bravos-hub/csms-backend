import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

export type AuditLogFilters = {
  actor?: string;
  action?: string;
  resource?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
};

export type CreateAuditLogDto = {
  actor: string;
  actorName?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: unknown;
  ipAddress?: string;
  userAgent?: string;
  status?: string;
  errorMessage?: string;
};

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  private toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }
    return value as Prisma.InputJsonValue;
  }

  async create(dto: CreateAuditLogDto) {
    const { details, ...rest } = dto;
    return this.prisma.auditLog.create({
      data: {
        ...rest,
        details: this.toJsonValue(details),
      },
    });
  }

  async findAll(filters?: AuditLogFilters) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (filters?.actor) where.actor = filters.actor;
    if (filters?.action) where.action = filters.action;
    if (filters?.resource) where.resource = filters.resource;
    if (filters?.status) where.status = filters.status;

    if (filters?.startDate || filters?.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = filters.startDate;
      if (filters.endDate) where.timestamp.lte = filters.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByResource(resource: string, resourceId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        resource,
        resourceId,
      },
      orderBy: { timestamp: 'desc' },
    });
  }

  async findByActor(actor: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { actor },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  // Helper method to log actions from other services
  async log(
    actor: string,
    action: string,
    resource: string,
    resourceId?: string,
    details?: unknown,
    actorName?: string,
  ) {
    return this.create({
      actor,
      actorName,
      action,
      resource,
      resourceId,
      details,
      status: 'SUCCESS',
    });
  }
}
