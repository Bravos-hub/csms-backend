import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { NotificationService } from '../notification/notification-service.service';
import { StopSessionDto, SessionFilterDto } from './dto/session.dto';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import { parsePaginationOptions } from '../../common/utils/pagination';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly ocpiTokenSync: OcpiTokenSyncService,
  ) {}

  async getActiveSessions(limit?: unknown, offset?: unknown) {
    const pagination = parsePaginationOptions(
      { limit, offset },
      { limit: 50, maxLimit: 100 },
    );
    return this.prisma.session.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { startTime: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
    });
  }

  async findById(id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async getHistory(filter: SessionFilterDto) {
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.stationId) where.stationId = filter.stationId;
    const pagination = parsePaginationOptions(
      { limit: filter.limit, offset: filter.offset },
      { limit: 50, maxLimit: 200 },
    );
    return this.prisma.session.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
    });
  }

  async stopSession(id: string, stopDto: StopSessionDto) {
    const session = await this.findById(id);
    if (session.status !== 'ACTIVE') return session;

    // Stop logic & Update
    const updatedSession = await this.prisma.session.update({
      where: { id },
      data: {
        status: 'STOPPED',
        endTime: new Date(),
      },
    });

    // Notify User
    if (updatedSession.userId) {
      // Need to fetch user here or include in update? Fetch separate
      this.notifyUserOfStop(updatedSession.userId, updatedSession as any);
    }

    return updatedSession;
  }

  private async notifyUserOfStop(userId: string, session: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user && user.phone) {
      const cost = (session.totalEnergy || 0) * 0.5; // Mock Rate
      const msg = `EvZone: Charging Stopped. Energy: ${session.totalEnergy}Wh. Est Cost: $${cost.toFixed(2)}`;
      await this.notificationService.sendSms(user.phone, msg);
    }
  }

  async getStatsSummary() {
    return {
      totalEnergy: 15403,
      activeSessions: await this.prisma.session.count({
        where: { status: 'ACTIVE' },
      }),
      completedToday: 42,
    };
  }

  // --- OCPP ---
  async handleOcppMessage(message: any) {
    const normalized = this.normalizeSessionEvent(message);
    if (!normalized.chargePointId) return;

    if (normalized.action === 'StartTransaction') {
      await this.handleStartTransaction(
        normalized.chargePointId,
        normalized.payload,
      );
      return;
    }

    if (normalized.action === 'StopTransaction') {
      await this.handleStopTransaction(
        normalized.chargePointId,
        normalized.payload,
      );
      return;
    }

    if (normalized.action === 'TransactionEvent') {
      await this.handleTransactionEvent(
        normalized.chargePointId,
        normalized.payload,
      );
      return;
    }

    if (normalized.eventType === 'SessionStarted') {
      await this.handleStartTransaction(
        normalized.chargePointId,
        normalized.payload,
      );
      return;
    }

    if (normalized.eventType === 'SessionStopped') {
      await this.handleStopTransaction(
        normalized.chargePointId,
        normalized.payload,
      );
    }
  }

  private async handleStartTransaction(ocppId: string, payload: any) {
    this.logger.log(`Starting Transaction for ${ocppId}`);
    const txId = payload.transactionId?.toString();
    if (txId) {
      const existing = await this.prisma.session.findUnique({
        where: { ocppTxId: txId },
        select: { id: true },
      });
      if (existing) {
        return;
      }
    }

    // Look up the charge point to get the stationId
    const chargePoint = await this.prisma.chargePoint.findUnique({
      where: { ocppId },
      select: { stationId: true },
    });

    if (!chargePoint) {
      this.logger.error(
        `ChargePoint ${ocppId} not found, cannot start session`,
      );
      return;
    }

    const idTag = this.extractIdToken(payload);

    await this.prisma.session.create({
      data: {
        ocppId: ocppId,
        connectorId:
          Number(payload.connectorId || payload.evse?.connectorId) || 0,
        idTag,
        ocppTxId: txId,
        startTime: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        meterStart: Number(payload.meterStart) || 0,
        status: 'ACTIVE',
        stationId: chargePoint.stationId,
      },
    });

    await this.syncIdTagTokenSafe(idTag);
  }

  private async handleStopTransaction(ocppId: string, payload: any) {
    this.logger.log(`Stopping Transaction for ${ocppId}`);
    const txId = payload.transactionId?.toString();
    if (!txId) {
      this.logger.warn('Missing transaction ID in stop transaction payload');
      return;
    }
    const session = await this.prisma.session.findUnique({
      where: { ocppTxId: txId },
    });

    if (session) {
      const meterStop = Number(payload.meterStop) || 0;
      const totalEnergy = Math.max(0, meterStop - session.meterStart);

      const updated = await this.prisma.session.update({
        where: { id: session.id },
        data: {
          endTime: payload.timestamp ? new Date(payload.timestamp) : new Date(),
          meterStop,
          totalEnergy,
          status: 'COMPLETED',
        },
      });

      if (updated.userId) {
        await this.notifyUserOfStop(updated.userId, updated);
      }
    } else {
      this.logger.warn(`Session not found for transaction ${txId}`);
    }
  }

  private async handleTransactionEvent(ocppId: string, payload: any) {
    const eventType = String(payload?.eventType || '').toLowerCase();
    const transactionId = payload?.transactionInfo?.transactionId?.toString();
    if (!transactionId) {
      this.logger.warn('Missing transaction ID in TransactionEvent payload');
      return;
    }

    const timestamp = payload?.timestamp
      ? new Date(payload.timestamp)
      : new Date();
    const extractedMeterWh = this.extractMeterWhFromTransactionEvent(payload);
    const fallbackMeter = Number(payload?.meterValue);
    const meterWh =
      extractedMeterWh !== undefined
        ? extractedMeterWh
        : Number.isFinite(fallbackMeter)
          ? fallbackMeter
          : undefined;
    const connectorId =
      Number(payload?.evse?.connectorId || payload?.connectorId) ||
      Number(payload?.evse?.id) ||
      0;

    if (eventType === 'started') {
      await this.handleStartTransaction(ocppId, {
        transactionId,
        connectorId,
        idTag: this.extractIdToken(payload),
        timestamp,
        meterStart: meterWh ?? 0,
      });
      return;
    }

    const session = await this.prisma.session.findUnique({
      where: { ocppTxId: transactionId },
    });

    if (!session) {
      this.logger.warn(
        `Session not found for transaction event ${transactionId} (${eventType})`,
      );
      return;
    }

    if (eventType === 'updated') {
      if (meterWh === undefined) return;
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          meterStop: meterWh,
          totalEnergy: Math.max(0, meterWh - session.meterStart),
        },
      });
      return;
    }

    if (eventType === 'ended') {
      const meterStop = meterWh ?? session.meterStart;
      const totalEnergy = Math.max(0, meterStop - session.meterStart);
      const updated = await this.prisma.session.update({
        where: { id: session.id },
        data: {
          endTime: timestamp,
          meterStop,
          totalEnergy,
          status: 'COMPLETED',
        },
      });
      if (updated.userId) {
        await this.notifyUserOfStop(updated.userId, updated);
      }
    }
  }

  private normalizeSessionEvent(message: any): {
    chargePointId?: string;
    eventType?: string;
    action?: string;
    payload: Record<string, any>;
  } {
    const input = this.unwrapEnvelope(message);
    if (!input || typeof input !== 'object') {
      return { payload: {} };
    }

    const chargePointId = this.readString(
      input.chargePointId || input.ocppId || input.chargePoint?.ocppId,
    );
    const eventType = this.readString(input.eventType);
    const topLevelAction = this.readString(input.action);
    const rawPayload =
      input.payload && typeof input.payload === 'object' ? input.payload : {};
    const payloadData =
      rawPayload.payload &&
      typeof rawPayload.payload === 'object' &&
      !Array.isArray(rawPayload.payload)
        ? rawPayload.payload
        : rawPayload;
    const payloadAction = this.readString(rawPayload.action);
    const action = topLevelAction || payloadAction;
    const payload: Record<string, any> =
      action && payloadData && typeof payloadData === 'object'
        ? {
            ...payloadData,
            transactionId:
              payloadData.transactionId || rawPayload.transactionId,
          }
        : payloadData;

    return {
      chargePointId,
      eventType,
      action,
      payload: payload || {},
    };
  }

  private unwrapEnvelope(message: any): any {
    if (typeof message === 'string') {
      try {
        return JSON.parse(message);
      } catch {
        return null;
      }
    }
    if (message && typeof message === 'object' && message.value !== undefined) {
      return this.unwrapEnvelope(message.value);
    }
    return message;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private extractIdToken(payload: any): string {
    if (typeof payload?.idTag === 'string' && payload.idTag.trim().length > 0) {
      return payload.idTag.trim();
    }
    if (
      payload?.idToken &&
      typeof payload.idToken === 'object' &&
      typeof payload.idToken.idToken === 'string' &&
      payload.idToken.idToken.trim().length > 0
    ) {
      return payload.idToken.idToken.trim();
    }
    return '';
  }

  private extractMeterWhFromTransactionEvent(payload: any): number | undefined {
    const meterValues = Array.isArray(payload?.meterValue)
      ? payload.meterValue
      : [];
    for (const meterValue of meterValues) {
      const sampledValues = Array.isArray(meterValue?.sampledValue)
        ? meterValue.sampledValue
        : [];
      for (const sampled of sampledValues) {
        const value = Number(sampled?.value);
        if (!Number.isFinite(value)) continue;
        const measurand = String(sampled?.measurand || '').toLowerCase();
        if (
          measurand &&
          measurand !== 'energy.active.import.register' &&
          measurand !== 'energy.active.export.register'
        ) {
          continue;
        }
        const unit = String(sampled?.unitOfMeasure?.unit || sampled?.unit || '')
          .trim()
          .toLowerCase();
        if (unit === 'kwh') return value * 1000;
        return value;
      }
    }
    return undefined;
  }

  private async syncIdTagTokenSafe(idTag?: string) {
    try {
      await this.ocpiTokenSync.syncIdTagToken(idTag || null);
    } catch (error) {
      this.logger.warn(
        'Failed to sync OCPI token for idTag',
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }
}
