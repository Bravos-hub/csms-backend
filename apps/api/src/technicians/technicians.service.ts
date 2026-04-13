import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type TechnicianStationContext = {
  stationId: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  attendantName: string | null;
};

@Injectable()
export class TechniciansService {
  constructor(private prisma: PrismaService) {}

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

  async updateStatus(
    userId: string,
    data: { status: string; location?: string },
  ) {
    if (!userId) throw new ForbiddenException('Invalid authenticated user');
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

  async getAssignment(userId: string) {
    if (!userId) throw new ForbiddenException('Invalid authenticated user');
    const context = await this.resolveActiveStationContext(userId);
    if (!context) return null;

    const station = await this.prisma.station.findFirst({
      where: { id: context.stationId },
      include: {
        jobs: {
          where: { status: { in: ['AVAILABLE', 'IN_PROGRESS'] } },
        },
        chargePoints: true,
      },
    });

    if (!station) return null;

    const shift =
      context.shiftStart && context.shiftEnd
        ? `${context.shiftStart} - ${context.shiftEnd}`
        : null;

    return {
      id: station.id,
      name: station.name,
      location: station.address,
      status: station.status.toLowerCase(),
      capability:
        station.type === 'SWAPPING'
          ? 'Swap'
          : station.type === 'CHARGING'
            ? 'Charge'
            : 'Both',
      shift,
      attendant: context.attendantName,
      metrics: [
        {
          label: 'Chargers available',
          value: `${station.chargePoints.filter((c) => c.status === 'AVAILABLE').length} / ${station.chargePoints.length}`,
          tone: 'ok',
        },
        {
          label: 'Jobs Pending',
          value: `${station.jobs.length}`,
          tone: station.jobs.length > 0 ? 'warn' : 'ok',
        },
      ],
    };
  }

  async getJobs(userId: string) {
    if (!userId) throw new ForbiddenException('Invalid authenticated user');
    const context = await this.resolveActiveStationContext(userId);

    const orConditions: Prisma.JobWhereInput[] = [{ technicianId: userId }];

    if (context?.stationId) {
      orConditions.push({
        stationId: context.stationId,
        technicianId: null,
        status: 'AVAILABLE',
      });
    }

    const jobs = await this.prisma.job.findMany({
      where: { OR: orConditions },
      include: { station: true },
      orderBy: { createdAt: 'desc' },
    });

    return jobs.map((j) => ({
      id: j.id,
      title: j.title,
      station: j.station.name,
      location: j.station.address,
      priority: j.priority,
      status: j.status,
      pay: j.pay,
      posted: j.createdAt.toISOString(),
      description: j.description,
    }));
  }

  private async resolveActiveStationContext(
    userId: string,
  ): Promise<TechnicianStationContext | null> {
    const now = new Date();

    const attendantAssignment = await this.prisma.attendantAssignment.findFirst(
      {
        where: {
          userId,
          isActive: true,
          OR: [{ activeFrom: null }, { activeFrom: { lte: now } }],
          AND: [{ OR: [{ activeTo: null }, { activeTo: { gte: now } }] }],
        },
        select: {
          stationId: true,
          shiftStart: true,
          shiftEnd: true,
          user: { select: { name: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      },
    );

    if (attendantAssignment) {
      return {
        stationId: attendantAssignment.stationId,
        shiftStart: attendantAssignment.shiftStart,
        shiftEnd: attendantAssignment.shiftEnd,
        attendantName: attendantAssignment.user.name || null,
      };
    }

    const teamAssignment = await this.prisma.stationTeamAssignment.findFirst({
      where: {
        userId,
        isActive: true,
      },
      select: {
        stationId: true,
        shiftStart: true,
        shiftEnd: true,
        user: { select: { name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!teamAssignment) {
      return null;
    }

    return {
      stationId: teamAssignment.stationId,
      shiftStart: teamAssignment.shiftStart,
      shiftEnd: teamAssignment.shiftEnd,
      attendantName: teamAssignment.user.name || null,
    };
  }
}
