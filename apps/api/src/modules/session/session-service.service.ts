import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { NotificationService } from '../notification/notification-service.service';
import { StopSessionDto, SessionFilterDto } from './dto/session.dto';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) { }

  async getActiveSessions() {
    return this.prisma.session.findMany({ where: { status: 'ACTIVE' } });
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
    return this.prisma.session.findMany({ where, orderBy: { startTime: 'desc' } });
  }

  async stopSession(id: string, stopDto: StopSessionDto) {
    const session = await this.findById(id);
    if (session.status !== 'ACTIVE') return session;

    // Stop logic & Update
    const updatedSession = await this.prisma.session.update({
      where: { id },
      data: {
        status: 'STOPPED',
        endTime: new Date()
      }
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
      const cost = (session.totalEnergy || 0) * 0.50; // Mock Rate
      const msg = `EvZone: Charging Stopped. Energy: ${session.totalEnergy}Wh. Est Cost: $${cost.toFixed(2)}`;
      await this.notificationService.sendSms(user.phone, msg);
    }
  }

  async getStatsSummary() {
    return {
      totalEnergy: 15403,
      activeSessions: await this.prisma.session.count({ where: { status: 'ACTIVE' } }),
      completedToday: 42
    };
  }

  // --- OCPP ---
  async handleOcppMessage(message: any) {
    const chargePointId = message.chargePointId;
    const eventType = message.eventType;
    const payload = message.payload;

    if (eventType === 'SessionStarted' || payload?.action === 'StartTransaction') {
      const startPayload = payload?.action === 'StartTransaction'
        ? { ...payload.payload, transactionId: payload.transactionId }
        : payload;
      await this.handleStartTransaction(chargePointId, startPayload);
    } else if (eventType === 'SessionStopped' || payload?.action === 'StopTransaction') {
      const stopPayload = payload?.action === 'StopTransaction'
        ? { ...payload.payload, transactionId: payload.transactionId }
        : payload;
      await this.handleStopTransaction(chargePointId, stopPayload);
    } else if (message.action === 'StartTransaction') {
      await this.handleStartTransaction(chargePointId, payload);
    } else if (message.action === 'StopTransaction') {
      await this.handleStopTransaction(chargePointId, payload);
    }
  }

  private async handleStartTransaction(ocppId: string, payload: any) {
    this.logger.log(`Starting Transaction for ${ocppId}`);

    // Look up the charge point to get the stationId
    const chargePoint = await this.prisma.chargePoint.findUnique({
      where: { ocppId },
      select: { stationId: true },
    });

    if (!chargePoint) {
      this.logger.error(`ChargePoint ${ocppId} not found, cannot start session`);
      return;
    }

    await this.prisma.session.create({
      data: {
        ocppId: ocppId,
        connectorId: Number(payload.connectorId) || 0,
        idTag: String(payload.idTag || ''),
        ocppTxId: payload.transactionId?.toString(),
        startTime: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        meterStart: Number(payload.meterStart) || 0,
        status: 'ACTIVE',
        stationId: chargePoint.stationId,
      },
    });
  }

  private async handleStopTransaction(ocppId: string, payload: any) {
    this.logger.log(`Stopping Transaction for ${ocppId}`);
    const txId = payload.transactionId?.toString();
    if (!txId) {
      this.logger.warn('Missing transaction ID in stop transaction payload');
      return;
    }
    const session = await this.prisma.session.findUnique({ where: { ocppTxId: txId } });

    if (session) {
      const meterStop = Number(payload.meterStop) || 0;
      const totalEnergy = Math.max(0, meterStop - session.meterStart);
      
      const updated = await this.prisma.session.update({
        where: { id: session.id },
        data: {
          endTime: payload.timestamp ? new Date(payload.timestamp) : new Date(),
          meterStop,
          totalEnergy,
          status: 'COMPLETED'
        }
      });

      if (updated.userId) {
        await this.notifyUserOfStop(updated.userId, updated);
      }
    } else {
      this.logger.warn(`Session not found for transaction ${txId}`);
    }
  }
}
