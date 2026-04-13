import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { NotificationService } from '../notification/notification-service.service';
import { StopSessionDto, SessionFilterDto } from './dto/session.dto';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import { parsePaginationOptions } from '../../common/utils/pagination';
import { EnergyManagementService } from '../energy-management/energy-management.service';
import {
  TenantGuardrailsService,
  TenantScope,
} from '../../common/tenant/tenant-guardrails.service';

type OcppSessionPayload = Record<string, unknown>;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly ocpiTokenSync: OcpiTokenSyncService,
    private readonly energyManagement: EnergyManagementService,
    private readonly tenantGuardrails: TenantGuardrailsService,
  ) {}

  private async requireChargeScope(): Promise<TenantScope> {
    return this.tenantGuardrails.requireTenantScope('charge');
  }

  private async listScopedStationIds(
    scope: TenantScope,
    stationId?: string,
  ): Promise<string[]> {
    return this.tenantGuardrails.listOwnedStationIds(
      scope,
      stationId ? { id: stationId } : undefined,
    );
  }

  async getActiveSessions(limit?: unknown, offset?: unknown) {
    const scope = await this.requireChargeScope();
    const stationIds = await this.listScopedStationIds(scope);
    if (stationIds.length === 0) {
      return [];
    }

    const pagination = parsePaginationOptions(
      { limit, offset },
      { limit: 50, maxLimit: 100 },
    );
    return this.prisma.session.findMany({
      where: { status: 'ACTIVE', stationId: { in: stationIds } },
      orderBy: { startTime: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
    });
  }

  async findById(id: string, scopeOverride?: TenantScope) {
    const scope = scopeOverride || (await this.requireChargeScope());
    const stationIds = await this.listScopedStationIds(scope);
    if (stationIds.length === 0) {
      throw new NotFoundException('Session not found');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id,
        stationId: { in: stationIds },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async getHistory(filter: SessionFilterDto) {
    const scope = await this.requireChargeScope();
    const scopedStationIds = await this.listScopedStationIds(
      scope,
      filter.stationId,
    );
    if (scopedStationIds.length === 0) {
      return [];
    }

    const where: Prisma.SessionWhereInput = {
      stationId: { in: scopedStationIds },
    };
    if (filter.status) where.status = filter.status;
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
    const scope = await this.requireChargeScope();
    void stopDto;
    const session = await this.findById(id, scope);
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
      void this.notifyUserOfStop(updatedSession.userId, {
        totalEnergy: updatedSession.totalEnergy,
      });
    }

    await this.syncEnergyManagementStation(
      updatedSession.stationId,
      'Session stopped',
    );

    return updatedSession;
  }

  private async notifyUserOfStop(
    userId: string,
    session: { totalEnergy: number },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user && user.phone) {
      const cost = (session.totalEnergy || 0) * 0.5; // Mock Rate
      const msg = `EvZone: Charging Stopped. Energy: ${session.totalEnergy}Wh. Est Cost: $${cost.toFixed(2)}`;
      await this.notificationService.sendSms(user.phone, msg, {
        userId: user.id,
        zoneId: user.zoneId,
        country: user.country,
        region: user.region,
      });
    }
  }

  async getStatsSummary() {
    const scope = await this.requireChargeScope();
    const stationIds = await this.listScopedStationIds(scope);
    if (stationIds.length === 0) {
      return {
        totalEnergy: 0,
        activeSessions: 0,
        completedToday: 0,
      };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [aggregate, activeSessions, completedToday] = await Promise.all([
      this.prisma.session.aggregate({
        where: {
          stationId: { in: stationIds },
        },
        _sum: {
          totalEnergy: true,
        },
      }),
      this.prisma.session.count({
        where: {
          stationId: { in: stationIds },
          status: 'ACTIVE',
        },
      }),
      this.prisma.session.count({
        where: {
          stationId: { in: stationIds },
          status: { in: ['COMPLETED', 'STOPPED'] },
          startTime: { gte: startOfDay },
        },
      }),
    ]);

    return {
      totalEnergy: Number((aggregate._sum.totalEnergy || 0).toFixed(2)),
      activeSessions,
      completedToday,
    };
  }

  // --- OCPP ---
  async handleOcppMessage(message: unknown) {
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

  private async handleStartTransaction(
    ocppId: string,
    payload: OcppSessionPayload,
  ) {
    this.logger.log(`Starting Transaction for ${ocppId}`);
    const txId = this.toTrimmedString(payload.transactionId);
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
    const evse = this.readRecord(payload.evse);
    const connectorId =
      this.toFiniteNumber(payload.connectorId) ??
      this.toFiniteNumber(evse?.connectorId) ??
      0;
    const timestamp = this.toDate(payload.timestamp) ?? new Date();
    const meterStart = this.toFiniteNumber(payload.meterStart) ?? 0;

    await this.prisma.session.create({
      data: {
        ocppId: ocppId,
        connectorId,
        idTag,
        ocppTxId: txId,
        startTime: timestamp,
        meterStart,
        status: 'ACTIVE',
        stationId: chargePoint.stationId,
      },
    });

    await this.syncIdTagTokenSafe(idTag);
    await this.syncEnergyManagementStation(
      chargePoint.stationId,
      'Session started',
    );
  }

  private async handleStopTransaction(
    ocppId: string,
    payload: OcppSessionPayload,
  ) {
    this.logger.log(`Stopping Transaction for ${ocppId}`);
    const txId = this.toTrimmedString(payload.transactionId);
    if (!txId) {
      this.logger.warn('Missing transaction ID in stop transaction payload');
      return;
    }
    const session = await this.prisma.session.findUnique({
      where: { ocppTxId: txId },
    });

    if (session) {
      const meterStop = this.toFiniteNumber(payload.meterStop) ?? 0;
      const totalEnergy = Math.max(0, meterStop - session.meterStart);
      const endTime = this.toDate(payload.timestamp) ?? new Date();

      const updated = await this.prisma.session.update({
        where: { id: session.id },
        data: {
          endTime,
          meterStop,
          totalEnergy,
          status: 'COMPLETED',
        },
      });

      if (updated.userId) {
        await this.notifyUserOfStop(updated.userId, updated);
      }

      await this.syncEnergyManagementStation(
        session.stationId,
        'Session stopped',
      );
    } else {
      this.logger.warn(`Session not found for transaction ${txId}`);
    }
  }

  private async handleTransactionEvent(
    ocppId: string,
    payload: OcppSessionPayload,
  ) {
    const eventType = (this.readString(payload.eventType) || '').toLowerCase();
    const transactionInfo = this.readRecord(payload.transactionInfo);
    const transactionId = this.toTrimmedString(transactionInfo?.transactionId);
    if (!transactionId) {
      this.logger.warn('Missing transaction ID in TransactionEvent payload');
      return;
    }

    const timestamp = this.toDate(payload.timestamp) ?? new Date();
    const extractedMeterWh = this.extractMeterWhFromTransactionEvent(payload);
    const fallbackMeter = this.toFiniteNumber(payload.meterValue);
    const meterWh =
      extractedMeterWh !== undefined
        ? extractedMeterWh
        : fallbackMeter !== undefined
          ? fallbackMeter
          : undefined;
    const evse = this.readRecord(payload.evse);
    const connectorId =
      this.toFiniteNumber(evse?.connectorId) ??
      this.toFiniteNumber(payload.connectorId) ??
      this.toFiniteNumber(evse?.id) ??
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
      await this.syncEnergyManagementStation(
        session.stationId,
        'Session telemetry updated',
      );
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
      await this.syncEnergyManagementStation(
        session.stationId,
        'Session ended',
      );
    }
  }

  private normalizeSessionEvent(message: unknown): {
    chargePointId?: string;
    eventType?: string;
    action?: string;
    payload: OcppSessionPayload;
  } {
    const input = this.unwrapEnvelope(message);
    if (!this.isRecord(input)) {
      return { payload: {} };
    }

    const chargePoint = this.readRecord(input.chargePoint);
    const chargePointId = this.readString(
      input.chargePointId || input.ocppId || chargePoint?.ocppId,
    );
    const eventType = this.readString(input.eventType);
    const topLevelAction = this.readString(input.action);
    const rawPayload = this.readRecord(input.payload) ?? {};
    const nestedPayload = this.readRecord(rawPayload.payload);
    const payloadData = nestedPayload ?? rawPayload;
    const payloadAction = this.readString(rawPayload.action);
    const action = topLevelAction || payloadAction;
    const payload: OcppSessionPayload =
      action && payloadData
        ? {
            ...payloadData,
            transactionId:
              payloadData.transactionId || rawPayload.transactionId,
          }
        : { ...payloadData };

    return {
      chargePointId,
      eventType,
      action,
      payload,
    };
  }

  private unwrapEnvelope(message: unknown): unknown {
    if (typeof message === 'string') {
      try {
        return JSON.parse(message) as unknown;
      } catch {
        return null;
      }
    }
    if (this.isRecord(message) && message.value !== undefined) {
      return this.unwrapEnvelope(message.value);
    }
    return message;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    return this.isRecord(value) ? value : undefined;
  }

  private toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private toTrimmedString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    return undefined;
  }

  private toDate(value: unknown): Date | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return undefined;
  }

  private extractIdToken(payload: OcppSessionPayload): string {
    const idTag = this.readString(payload.idTag);
    if (idTag) {
      return idTag;
    }
    const idToken = this.readRecord(payload.idToken);
    if (
      idToken &&
      typeof idToken.idToken === 'string' &&
      idToken.idToken.trim().length > 0
    ) {
      return idToken.idToken.trim();
    }
    return '';
  }

  private extractMeterWhFromTransactionEvent(
    payload: OcppSessionPayload,
  ): number | undefined {
    const meterValues = Array.isArray(payload.meterValue)
      ? payload.meterValue
      : [];
    for (const meterValue of meterValues) {
      const meterValueRecord = this.readRecord(meterValue);
      if (!meterValueRecord) {
        continue;
      }
      const sampledValues = Array.isArray(meterValueRecord.sampledValue)
        ? meterValueRecord.sampledValue
        : [];
      for (const sampled of sampledValues) {
        const sampledRecord = this.readRecord(sampled);
        if (!sampledRecord) {
          continue;
        }
        const value = this.toFiniteNumber(sampledRecord.value);
        if (value === undefined) continue;
        const measurand = (this.readString(sampledRecord.measurand) || '')
          .trim()
          .toLowerCase();
        if (
          measurand &&
          measurand !== 'energy.active.import.register' &&
          measurand !== 'energy.active.export.register'
        ) {
          continue;
        }
        const unitOfMeasure = this.readRecord(sampledRecord.unitOfMeasure);
        const unit = (
          this.readString(unitOfMeasure?.unit) ||
          this.readString(sampledRecord.unit) ||
          ''
        )
          .trim()
          .toLowerCase();
        if (unit === 'kwh') return value * 1000;
        return value;
      }
    }
    return undefined;
  }

  private async syncEnergyManagementStation(
    stationId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.energyManagement.recalculateStation(stationId, reason);
    } catch (error) {
      this.logger.warn(
        `Energy management recalculation skipped for station ${stationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
