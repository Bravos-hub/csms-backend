import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CommandsService } from '../commands/commands.service';
import {
  BookingDispatchDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/booking.dto';

type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';

type ReservationDispatchResult = {
  commandId: string | null;
  status: string;
  correlationId: string | null;
  error: string | null;
};

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandsService: CommandsService,
  ) {}

  async findAll() {
    return this.prisma.booking.findMany({
      include: {
        user: true,
        station: true,
        events: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
        },
      },
      orderBy: { startTime: 'desc' },
    });
  }

  async findById(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        user: true,
        station: true,
        events: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async listEvents(id: string) {
    await this.findById(id);
    return this.prisma.bookingEvent.findMany({
      where: { bookingId: id },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async create(createDto: CreateBookingDto) {
    const startTime = this.parseIsoDateTime(createDto.startAt, 'startAt');
    const durationMinutes = this.resolveDurationMinutes(
      createDto.durationMinutes,
    );
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const autoCancelAt = new Date(startTime.getTime() + 15 * 60 * 1000);

    const userId = await this.resolveUserId(createDto.userId);
    const target = await this.resolveBookingTarget(
      createDto.stationId,
      createDto.chargePointId,
    );
    const reservationId = this.normalizeReservationId(
      createDto.reservationId ?? this.generateReservationId(),
    );
    const source = this.normalizeSource(createDto.source);

    const booking = await this.prisma.booking.create({
      data: {
        userId,
        stationId: target.stationId,
        chargePointId: target.chargePointId,
        reservationId,
        reservationSource: source,
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

    await this.recordEvent(
      booking.id,
      'BOOKING_CREATED',
      'api.booking.create',
      'PENDING',
      {
        reservationId,
        source,
        chargePointId: booking.chargePointId,
        stationId: booking.stationId,
      },
    );

    if (createDto.dispatchCommand !== false) {
      const dispatch = await this.enqueueReserveNowCommand(booking.id, {
        connectorId: createDto.connectorId,
        idTag: createDto.idTag,
        authorizationReference: createDto.authorizationReference,
        responseUrl: createDto.responseUrl,
        partnerId: createDto.partnerId,
        correlationId: createDto.correlationId,
      });

      await this.applyCommandState(booking.id, dispatch);
      await this.recordEvent(
        booking.id,
        'RESERVE_COMMAND_QUEUED',
        'api.booking.create',
        dispatch.status,
        {
          commandId: dispatch.commandId,
          correlationId: dispatch.correlationId,
          error: dispatch.error,
        },
      );
    }

    return this.findById(booking.id);
  }

  async cancel(id: string, reason?: string) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    const now = new Date();
    const cancelled = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        autoCancelReason: reason?.trim() || 'Cancelled by operator',
        historyLabel: `Cancelled ${now.toISOString()}`,
      },
    });

    await this.recordEvent(
      id,
      'BOOKING_CANCELLED',
      'api.booking.cancel',
      'CANCELLED',
      {
        reason: cancelled.autoCancelReason,
      },
    );

    const dispatch = await this.enqueueCancelReservationCommand(id, {
      reason: cancelled.autoCancelReason || undefined,
    });
    await this.applyCommandState(id, dispatch);
    await this.recordEvent(
      id,
      'CANCEL_COMMAND_QUEUED',
      'api.booking.cancel',
      dispatch.status,
      {
        commandId: dispatch.commandId,
        correlationId: dispatch.correlationId,
        error: dispatch.error,
      },
    );

    return this.findById(id);
  }

  async checkin(id: string) {
    const booking = await this.findById(id);
    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Booking is not in a check-in ready state');
    }

    const now = new Date();
    await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        checkedInAt: now,
        historyLabel: `Checked in ${now.toISOString()}`,
      },
    });

    await this.recordEvent(
      id,
      'BOOKING_CHECKED_IN',
      'api.booking.checkin',
      'CONFIRMED',
    );
    return this.findById(id);
  }

  async markNoShow(id: string, reason?: string) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    const now = new Date();
    await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'NO_SHOW',
        noShowAt: now,
        autoCancelReason: reason?.trim() || 'Marked as no-show by operator',
        historyLabel: `No-show ${now.toISOString()}`,
      },
    });

    await this.recordEvent(
      id,
      'BOOKING_NO_SHOW',
      'api.booking.no_show',
      'NO_SHOW',
      {
        reason,
      },
    );
    return this.findById(id);
  }

  async expire(id: string, reason?: string) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    const now = new Date();
    await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'EXPIRED',
        expiredAt: now,
        autoCancelReason: reason?.trim() || 'Expired by operator',
        historyLabel: `Expired ${now.toISOString()}`,
      },
    });

    await this.recordEvent(
      id,
      'BOOKING_EXPIRED',
      'api.booking.expire',
      'EXPIRED',
      {
        reason,
      },
    );
    return this.findById(id);
  }

  async update(id: string, dto: UpdateBookingDto) {
    const booking = await this.findById(id);
    this.assertMutableStatus(booking.status as BookingStatus);

    const data: Prisma.BookingUpdateInput = {};

    if (dto.status) {
      data.status = dto.status;
      const now = new Date();
      if (dto.status === 'CONFIRMED') {
        data.checkedInAt = now;
      } else if (dto.status === 'CANCELLED') {
        data.cancelledAt = now;
      } else if (dto.status === 'NO_SHOW') {
        data.noShowAt = now;
      } else if (dto.status === 'EXPIRED') {
        data.expiredAt = now;
      }
    }

    if (dto.startAt) {
      const startTime = this.parseIsoDateTime(dto.startAt, 'startAt');
      const durationMinutes = this.resolveDurationMinutes(
        dto.durationMinutes,
        Math.max(
          1,
          Math.floor(
            (booking.endTime.getTime() - booking.startTime.getTime()) / 60000,
          ),
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

    await this.prisma.booking.update({
      where: { id },
      data,
    });
    await this.recordEvent(
      id,
      'BOOKING_UPDATED',
      'api.booking.update',
      dto.status,
      {
        reason: dto.reason,
      },
    );

    return this.findById(id);
  }

  async expireOverdue() {
    const now = new Date();
    const overdue = await this.prisma.booking.findMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        endTime: { lt: now },
      },
      select: { id: true },
    });

    if (overdue.length === 0) {
      return {
        expiredCount: 0,
        executedAt: now.toISOString(),
      };
    }

    const ids = overdue.map((item) => item.id);
    const result = await this.prisma.booking.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'EXPIRED',
        expiredAt: now,
        autoCancelReason: 'Auto-expired overdue booking',
        historyLabel: `Auto-expired ${now.toISOString()}`,
      },
    });

    await this.prisma.bookingEvent.createMany({
      data: ids.map((id) => ({
        bookingId: id,
        eventType: 'BOOKING_AUTO_EXPIRED',
        status: 'EXPIRED',
        source: 'api.booking.expire_overdue',
        occurredAt: now,
        details: {
          reason: 'Auto-expired overdue booking',
        } as Prisma.InputJsonValue,
      })),
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
      include: {
        user: true,
        station: true,
        events: {
          orderBy: { occurredAt: 'desc' },
          take: 5,
        },
      },
    });
  }

  async dispatchReserveCommand(id: string, dto: BookingDispatchDto = {}) {
    await this.findById(id);
    const dispatch = await this.enqueueReserveNowCommand(id, {
      correlationId: dto.correlationId,
      responseUrl: dto.responseUrl,
      partnerId: dto.partnerId,
    });
    await this.applyCommandState(id, dispatch);
    await this.recordEvent(
      id,
      'RESERVE_COMMAND_MANUAL',
      'api.booking.dispatch',
      dispatch.status,
      {
        commandId: dispatch.commandId,
        correlationId: dispatch.correlationId,
        error: dispatch.error,
      },
    );
    return this.findById(id);
  }

  async dispatchCancelCommand(id: string, dto: BookingDispatchDto = {}) {
    await this.findById(id);
    const dispatch = await this.enqueueCancelReservationCommand(id, dto);
    await this.applyCommandState(id, dispatch);
    await this.recordEvent(
      id,
      'CANCEL_COMMAND_MANUAL',
      'api.booking.dispatch',
      dispatch.status,
      {
        commandId: dispatch.commandId,
        correlationId: dispatch.correlationId,
        error: dispatch.error,
      },
    );
    return this.findById(id);
  }

  private async enqueueReserveNowCommand(
    bookingId: string,
    input: {
      connectorId?: number;
      idTag?: string;
      authorizationReference?: string;
      responseUrl?: string;
      partnerId?: string;
      correlationId?: string;
    },
  ): Promise<ReservationDispatchResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        reservationId: true,
        chargePointId: true,
        stationId: true,
        endTime: true,
        customerRefSnapshot: true,
        reservationSource: true,
      },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (!booking.chargePointId || !booking.reservationId) {
      return {
        commandId: null,
        status: 'DispatchFailed',
        correlationId: null,
        error: 'Missing charge point or reservation id',
      };
    }

    const correlationId =
      input.correlationId?.trim() || `booking:${booking.id}:reserve`;

    try {
      const response = await this.commandsService.enqueueCommand({
        commandType: 'ReserveNow',
        chargePointId: booking.chargePointId,
        stationId: booking.stationId,
        connectorId: input.connectorId || 1,
        payload: {
          reservationId: booking.reservationId,
          id: booking.reservationId,
          connectorId: input.connectorId || 1,
          expiryDateTime: booking.endTime.toISOString(),
          idTag:
            input.idTag ||
            booking.customerRefSnapshot ||
            `booking-${booking.id}`,
          ...(input.authorizationReference
            ? { parentIdTag: input.authorizationReference }
            : {}),
          ...(input.responseUrl
            ? {
                ocpi: {
                  command: 'RESERVE_NOW',
                  requestId: correlationId,
                  responseUrl: input.responseUrl,
                  partnerId: input.partnerId || null,
                },
              }
            : {}),
        },
        requestedBy: {
          userId: 'booking-service',
          role: booking.reservationSource || 'LOCAL',
        },
        correlationId,
      });

      return {
        commandId: response.commandId,
        status: response.status,
        correlationId,
        error: null,
      };
    } catch (error) {
      return {
        commandId: null,
        status: 'DispatchFailed',
        correlationId,
        error:
          error instanceof Error ? error.message : 'Reserve dispatch failed',
      };
    }
  }

  private async enqueueCancelReservationCommand(
    bookingId: string,
    input: {
      reason?: string;
      responseUrl?: string;
      partnerId?: string;
      correlationId?: string;
    },
  ): Promise<ReservationDispatchResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        reservationId: true,
        chargePointId: true,
        stationId: true,
      },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (!booking.chargePointId || !booking.reservationId) {
      return {
        commandId: null,
        status: 'DispatchFailed',
        correlationId: null,
        error: 'Missing charge point or reservation id',
      };
    }

    const correlationId =
      input.correlationId?.trim() || `booking:${booking.id}:cancel`;

    try {
      const response = await this.commandsService.enqueueCommand({
        commandType: 'CancelReservation',
        chargePointId: booking.chargePointId,
        stationId: booking.stationId,
        payload: {
          reservationId: booking.reservationId,
          id: booking.reservationId,
          reason: input.reason || null,
          ...(input.responseUrl
            ? {
                ocpi: {
                  command: 'CANCEL_RESERVATION',
                  requestId: correlationId,
                  responseUrl: input.responseUrl,
                  partnerId: input.partnerId || null,
                },
              }
            : {}),
        },
        requestedBy: {
          userId: 'booking-service',
          role: 'LOCAL',
        },
        correlationId,
      });

      return {
        commandId: response.commandId,
        status: response.status,
        correlationId,
        error: null,
      };
    } catch (error) {
      return {
        commandId: null,
        status: 'DispatchFailed',
        correlationId,
        error:
          error instanceof Error ? error.message : 'Cancel dispatch failed',
      };
    }
  }

  private async applyCommandState(
    bookingId: string,
    state: ReservationDispatchResult,
  ): Promise<void> {
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        reservationCommandId: state.commandId,
        reservationCommandStatus: state.status,
        reservationCommandUpdatedAt: new Date(),
        ...(state.correlationId
          ? { commandCorrelationId: state.correlationId }
          : {}),
      },
    });
  }

  private async resolveBookingTarget(
    inputStationId: string | undefined,
    inputChargePointId: string | undefined,
  ): Promise<{ stationId: string; chargePointId: string }> {
    if (inputChargePointId?.trim()) {
      const chargePoint = await this.prisma.chargePoint.findFirst({
        where: {
          OR: [
            { id: inputChargePointId.trim() },
            { ocppId: inputChargePointId.trim() },
          ],
        },
        select: { id: true, stationId: true },
      });
      if (!chargePoint) {
        throw new BadRequestException('Provided chargePointId was not found');
      }
      if (
        inputStationId?.trim() &&
        chargePoint.stationId !== inputStationId.trim()
      ) {
        throw new BadRequestException(
          'chargePointId does not belong to the provided stationId',
        );
      }
      return {
        stationId: chargePoint.stationId,
        chargePointId: chargePoint.id,
      };
    }

    throw new BadRequestException('chargePointId is required for reservations');
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

  private normalizeReservationId(reservationId: number): number {
    const normalized = Math.floor(Number(reservationId));
    if (
      !Number.isFinite(normalized) ||
      normalized <= 0 ||
      normalized > 2147483647
    ) {
      throw new BadRequestException(
        'reservationId must be a positive 32-bit integer',
      );
    }
    return normalized;
  }

  private normalizeSource(value?: string): string {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return 'LOCAL';
    if (normalized !== 'LOCAL' && normalized !== 'OCPI') {
      throw new BadRequestException('source must be either LOCAL or OCPI');
    }
    return normalized;
  }

  private resolveDurationMinutes(
    value: number | undefined,
    fallback = 15,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.floor(value);
  }

  private parseIsoDateTime(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO datetime`);
    }
    return parsed;
  }

  private generateReservationId(): number {
    return Math.floor(Date.now() / 1000);
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

  private async recordEvent(
    bookingId: string,
    eventType: string,
    source: string,
    status?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.bookingEvent.create({
      data: {
        bookingId,
        eventType,
        source,
        status: status || null,
        details: details ? (details as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
