import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { NotificationService } from '../notification/notification-service.service';
import { StopSessionDto, SessionFilterDto } from './dto/session.dto';

@Injectable()
export class SessionService {
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
    const action = message.action || message.eventType; // Handle DomainEvent eventType
    const payload = message.payload;

    if (action === 'StartTransaction') {
      await this.handleStartTransaction(chargePointId, payload);
    } else if (action === 'StopTransaction') {
      await this.handleStopTransaction(chargePointId, payload);
    }
  }

  private async handleStartTransaction(ocppId: string, payload: any) {
    console.log(`Starting Transaction for ${ocppId}`, payload);
    await this.prisma.session.create({
      data: {
        ocppId: ocppId,
        connectorId: payload.connectorId,
        idTag: payload.idTag,
        ocppTxId: payload.transactionId?.toString(),
        startTime: new Date(payload.timestamp),
        meterStart: payload.meterStart,
        status: 'ACTIVE',
        stationId: 'UNKNOWN_YET',
        // Prisma requires stationId and ocppId to link relations if defined as such, 
        // but our Session model links `chargePoint` via `ocppId` field.
        // If strict relation, we might need valid foreign key.
        // Schema: `chargePoint ChargePoint @relation(fields: [ocppId], references: [ocppId])`
      }
    });
  }

  private async handleStopTransaction(ocppId: string, payload: any) {
    console.log(`Stopping Transaction for ${ocppId}`, payload);
    const txId = payload.transactionId?.toString();
    // Assuming txId is unique in DB
    const session = await this.prisma.session.findUnique({ where: { ocppTxId: txId } });

    if (session) {
      const updated = await this.prisma.session.update({
        where: { id: session.id },
        data: {
          endTime: new Date(payload.timestamp),
          meterStop: payload.meterStop,
          totalEnergy: payload.meterStop - session.meterStart,
          status: 'COMPLETED'
        }
      });

      if (updated.userId) {
        await this.notifyUserOfStop(updated.userId, updated);
      }
    } else {
      console.warn(`Session not found for transaction ${txId}`);
    }
  }
}
