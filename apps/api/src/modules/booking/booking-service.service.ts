import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateBookingDto, UpdateBookingDto } from './dto/booking.dto';

type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';

@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.booking.findMany({
      include: { user: true, station: true },
      orderBy: { startTime: 'desc' },
    });
  }

  async findById(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { user: true, station: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async create(createDto: CreateBookingDto) {
    const startTime = new Date(createDto.startAt);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startAt must be a valid ISO datetime');
    }

    const durationMinutes =
      typeof createDto.durationMinutes === 'number' &&
      createDto.durationMinutes > 0
        ? Math.floor(createDto.durationMinutes)
        : 15;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const autoCancelAt = new Date(startTime.getTime() + 15 * 60 * 1000);

    const userId = await this.resolveUserId(createDto.userId);
    const stationId = await this.resolveStationId(
      createDto.stationId,
      createDto.chargePointId,
    );

    return this.prisma.booking.create({
      data: {
        userId,
        stationId,
        chargePointId: createDto.chargePointId,
        startTime,
        endTime,
        status: 'PENDING',
        bookingType: 'advance',
        autoCancelAt,
        historyLabel: `Created ${new Date().toISOString()}`,
        customerNameSnapshot: createDto.customerNameSnapshot,
        customerRefSnapshot: createDto.customerRefSnapshot,
        vehicleModelSnapshot: createDto.vehicleModelSnapshot,
        vehiclePlateSnapshot: createDto.vehiclePlateSnapshot,
        requiredKwh: createDto.requiredKwh,
        feeAmount: createDto.feeAmount,
        feeCurrency: createDto.feeCurrency?.trim().toUpperCase() || 'UGX',
      },
    });
  }

  async cancel(id: string, reason?: string) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    return this.prisma.booking.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        autoCancelReason: reason?.trim() || 'Cancelled by operator',
        historyLabel: `Cancelled ${new Date().toISOString()}`,
      },
    });
  }

  async checkin(id: string) {
    const booking = await this.findById(id);
    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Booking is not in a check-in ready state');
    }

    return this.prisma.booking.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        historyLabel: `Checked in ${new Date().toISOString()}`,
      },
    });
  }

  async markNoShow(id: string, reason?: string) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    return this.prisma.booking.update({
      where: { id },
      data: {
        status: 'NO_SHOW',
        autoCancelReason: reason?.trim() || 'Marked as no-show by operator',
        historyLabel: `No-show ${new Date().toISOString()}`,
      },
    });
  }

  async expire(id: string, reason?: string) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    return this.prisma.booking.update({
      where: { id },
      data: {
        status: 'EXPIRED',
        autoCancelReason: reason?.trim() || 'Expired by operator',
        historyLabel: `Expired ${new Date().toISOString()}`,
      },
    });
  }

  async update(id: string, dto: UpdateBookingDto) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    const data: {
      status?: string;
      startTime?: Date;
      endTime?: Date;
      autoCancelReason?: string;
      historyLabel?: string;
    } = {};

    if (dto.status) {
      data.status = dto.status;
    }

    if (dto.startAt) {
      const startTime = new Date(dto.startAt);
      if (Number.isNaN(startTime.getTime())) {
        throw new BadRequestException('startAt must be a valid ISO datetime');
      }
      const durationMinutes =
        typeof dto.durationMinutes === 'number' && dto.durationMinutes > 0
          ? Math.floor(dto.durationMinutes)
          : Math.max(
              1,
              Math.floor(
                (booking.endTime.getTime() - booking.startTime.getTime()) /
                  60000,
              ),
            );

      data.startTime = startTime;
      data.endTime = new Date(
        startTime.getTime() + durationMinutes * 60 * 1000,
      );
    } else if (
      typeof dto.durationMinutes === 'number' &&
      dto.durationMinutes > 0
    ) {
      data.endTime = new Date(
        booking.startTime.getTime() +
          Math.floor(dto.durationMinutes) * 60 * 1000,
      );
    }

    if (dto.reason?.trim()) {
      data.autoCancelReason = dto.reason.trim();
    }

    data.historyLabel = `Updated ${new Date().toISOString()}`;

    return this.prisma.booking.update({
      where: { id },
      data,
    });
  }

  async expireOverdue() {
    const now = new Date();
    const result = await this.prisma.booking.updateMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        endTime: { lt: now },
      },
      data: {
        status: 'EXPIRED',
        autoCancelReason: 'Auto-expired overdue booking',
        historyLabel: `Auto-expired ${now.toISOString()}`,
      },
    });

    return {
      expiredCount: result.count,
      executedAt: now.toISOString(),
    };
  }

  async getQueue() {
    return this.prisma.booking.findMany({
      where: { status: { in: ['PENDING', 'CONFIRMED'] } },
      orderBy: { startTime: 'asc' },
      include: { user: true, station: true },
    });
  }

  private async resolveUserId(inputUserId?: string): Promise<string> {
    if (inputUserId?.trim()) {
      const user = await this.prisma.user.findUnique({
        where: { id: inputUserId.trim() },
        select: { id: true },
      });
      if (!user) {
        throw new BadRequestException('Provided userId was not found');
      }
      return user.id;
    }

    const fallback = await this.prisma.user.findFirst({ select: { id: true } });
    if (!fallback) {
      throw new BadRequestException('No user available to own booking');
    }
    return fallback.id;
  }

  private async resolveStationId(
    inputStationId?: string,
    chargePointId?: string,
  ): Promise<string> {
    if (inputStationId?.trim()) {
      const station = await this.prisma.station.findUnique({
        where: { id: inputStationId.trim() },
        select: { id: true },
      });
      if (!station) {
        throw new BadRequestException('Provided stationId was not found');
      }
      return station.id;
    }

    if (chargePointId?.trim()) {
      const chargePoint = await this.prisma.chargePoint.findFirst({
        where: {
          OR: [{ id: chargePointId.trim() }, { ocppId: chargePointId.trim() }],
        },
        select: { stationId: true },
      });
      if (chargePoint) {
        return chargePoint.stationId;
      }
    }

    const fallback = await this.prisma.station.findFirst({
      select: { id: true },
    });
    if (!fallback) {
      throw new BadRequestException('No station available for booking');
    }
    return fallback.id;
  }

  private assertMutableStatus(status: BookingStatus): void {
    if (
      status === 'CANCELLED' ||
      status === 'NO_SHOW' ||
      status === 'EXPIRED'
    ) {
      throw new BadRequestException('Booking is in a terminal state');
    }
  }
}
