import { Injectable, BadRequestException } from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { TopUpDto, GenerateInvoiceDto } from './dto/billing.dto';
import { parsePaginationOptions } from '../../common/utils/pagination';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // Wallet
  async getWalletBalance(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
      });
      // Auto-create for dev
      wallet = await this.prisma.wallet.create({
        data: {
          userId,
          organizationId: user?.organizationId || this.resolveTenantId(),
          balance: 0,
          currency: 'USD',
        },
      });
    }
    return wallet;
  }

  async getTransactions(userId: string, limit?: string, offset?: string) {
    const pagination = parsePaginationOptions(
      { limit, offset },
      { limit: 50, maxLimit: 200 },
    );
    const wallet = await this.getWalletBalance(userId);
    return this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
    });
  }

  async topUp(userId: string, dto: TopUpDto) {
    const wallet = await this.getWalletBalance(userId);
    const idempotencyKey =
      typeof dto.idempotencyKey === 'string' &&
      dto.idempotencyKey.trim().length > 0
        ? dto.idempotencyKey.trim()
        : undefined;

    if (idempotencyKey) {
      const duplicate = await this.prisma.transaction.findFirst({
        where: { walletId: wallet.id, idempotencyKey },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        return this.prisma.wallet.findUnique({ where: { id: wallet.id } });
      }
    }

    try {
      const updatedWallet = await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: dto.amount },
          currency:
            typeof dto.currency === 'string' && dto.currency.trim().length > 0
              ? dto.currency.trim().toUpperCase()
              : wallet.currency,
        },
      });

      await this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: dto.amount,
          type: 'CREDIT',
          status: 'POSTED',
          reconciliationState: 'RECONCILED',
          description: dto.note || 'Wallet TopUp',
          reference: 'PAY_' + Date.now(),
          correlationId: dto.correlationId || null,
          idempotencyKey: idempotencyKey || null,
          occurredAt: new Date(),
        },
      });

      return updatedWallet;
    } catch {
      throw new BadRequestException('Failed to process top-up');
    }
  }

  // Invoices
  async getInvoices(userId: string, limit?: string, offset?: string) {
    const pagination = parsePaginationOptions(
      { limit, offset },
      { limit: 50, maxLimit: 200 },
    );
    return this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
    });
  }

  async generateInvoice(dto: GenerateInvoiceDto) {
    const periodTo = dto.billingPeriodTo
      ? new Date(dto.billingPeriodTo)
      : new Date();
    const periodFrom = dto.billingPeriodFrom
      ? new Date(dto.billingPeriodFrom)
      : new Date(periodTo.getTime() - 30 * 24 * 3600 * 1000);
    if (
      Number.isNaN(periodTo.getTime()) ||
      Number.isNaN(periodFrom.getTime())
    ) {
      throw new BadRequestException('Invalid billing period supplied');
    }
    if (periodFrom.getTime() >= periodTo.getTime()) {
      throw new BadRequestException(
        'billingPeriodFrom must be before billingPeriodTo',
      );
    }

    if (dto.correlationId?.trim()) {
      const duplicate = await this.prisma.invoice.findFirst({
        where: { userId: dto.userId, correlationId: dto.correlationId.trim() },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        return duplicate;
      }
    }

    const sessions = await this.prisma.session.findMany({
      where: {
        userId: dto.userId,
        startTime: { gte: periodFrom, lte: periodTo },
      },
      select: { amount: true, totalEnergy: true },
    });

    const tariffRate = await this.resolveFallbackTariffRate(
      dto.userId,
      periodTo,
    );
    const totalAmount = Number(
      sessions
        .reduce((sum, session) => {
          if (session.amount > 0) {
            return sum + session.amount;
          }
          if (tariffRate > 0 && session.totalEnergy > 0) {
            return sum + session.totalEnergy * tariffRate;
          }
          return sum;
        }, 0)
        .toFixed(4),
    );
    const dueInDays = dto.dueInDays && dto.dueInDays > 0 ? dto.dueInDays : 7;
    const dueDate = new Date(Date.now() + dueInDays * 24 * 3600 * 1000);

    return this.prisma.invoice.create({
      data: {
        userId: dto.userId,
        totalAmount,
        currency: this.normalizeCurrency(dto.currency),
        status: totalAmount > 0 ? 'ISSUED' : 'DRAFT',
        settlementStatus: totalAmount > 0 ? 'RECONCILING' : 'RECONCILED',
        dueDate,
        issuedAt: new Date(),
        billingPeriodFrom: periodFrom,
        billingPeriodTo: periodTo,
        sourceSessionCount: sessions.length,
        correlationId: dto.correlationId?.trim() || null,
      },
    });
  }

  // Tariffs
  async getTariffs() {
    const tenantId = this.resolveTenantId();
    if (!tenantId) {
      return [];
    }

    const calendars = await this.prisma.tariffCalendar.findMany({
      where: {
        tenantId,
        status: { in: ['ACTIVE', 'DRAFT'] },
      },
      orderBy: [
        { status: 'asc' },
        { effectiveFrom: 'desc' },
        { updatedAt: 'desc' },
      ],
      take: 30,
    });

    return calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      currency: calendar.currency,
      status: calendar.status,
      pricePerKwh: this.readTariffRate(calendar.bands),
      effectiveFrom: calendar.effectiveFrom,
      effectiveTo: calendar.effectiveTo,
    }));
  }
  // Admin - All Payments
  async getAllPayments(query: { limit?: string; offset?: string } = {}) {
    const pagination = parsePaginationOptions(
      { limit: query.limit, offset: query.offset },
      { limit: 50, maxLimit: 200 },
    );
    const transactions = await this.prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
      include: {
        wallet: { include: { user: true } },
        paymentIntent: {
          include: {
            paymentMethod: { select: { type: true } },
          },
        },
      },
    });

    return transactions.map((t) => ({
      id: t.id,
      ref: t.reference || t.id,
      type: t.type,
      method: t.paymentIntent?.paymentMethod?.type || 'WALLET',
      amount: t.amount,
      fee: 0,
      netAmount: t.amount,
      currency: t.wallet.currency,
      period: t.createdAt.toISOString(),
      sessions: 0,
      status:
        t.status === 'POSTED'
          ? 'Completed'
          : t.status === 'FAILED' || t.status === 'REVERSED'
            ? 'Failed'
            : 'Processing',
      user: t.wallet.user?.name || null,
      correlationId: t.correlationId,
      reconciliationState: t.reconciliationState,
    }));
  }

  // Settlements
  async getSettlements(
    status?: string,
    region?: string,
    limit?: string,
    offset?: string,
  ) {
    const where: Prisma.InvoiceWhereInput = {};
    const pagination = parsePaginationOptions(
      { limit, offset },
      { limit: 50, maxLimit: 200 },
    );

    if (status?.trim()) {
      where.settlementStatus = status.trim().toUpperCase();
    }

    if (region) {
      where.user = {
        region: {
          contains: region,
          mode: 'insensitive',
        },
      };
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            region: true,
            organization: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
    });

    return invoices.map((invoice) => ({
      id: invoice.id,
      region: invoice.user.region || 'Unknown',
      org: invoice.user.organization?.name || invoice.user.name,
      type: 'Invoice Settlement',
      amount: invoice.totalAmount,
      currency: invoice.currency,
      status:
        invoice.settlementStatus === 'RECONCILED'
          ? 'completed'
          : invoice.settlementStatus === 'DISPUTED'
            ? 'disputed'
            : 'reconciling',
      startedAt: invoice.issuedAt.toISOString(),
      finishedAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
      note: invoice.correlationId,
    }));
  }

  private resolveTenantId(): string | null {
    const context = this.tenantContext.get();
    return (
      context?.effectiveOrganizationId ||
      context?.authenticatedOrganizationId ||
      null
    );
  }

  private normalizeCurrency(value?: string): string {
    const normalized = (value || 'USD').trim().toUpperCase();
    if (normalized.length < 3 || normalized.length > 4) {
      throw new BadRequestException('currency must be a valid code');
    }
    return normalized;
  }

  private async resolveFallbackTariffRate(
    userId: string,
    at: Date,
  ): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });
    if (!user?.organizationId) {
      return 0;
    }

    const calendar = await this.prisma.tariffCalendar.findFirst({
      where: {
        tenantId: user.organizationId,
        status: 'ACTIVE',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
      select: { bands: true },
    });

    if (!calendar) {
      return 0;
    }

    return this.readTariffRate(calendar.bands);
  }

  private readTariffRate(bands: Prisma.JsonValue): number {
    if (!Array.isArray(bands)) {
      return 0;
    }

    let sum = 0;
    let count = 0;
    for (const entry of bands) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const value = (entry as Record<string, unknown>).pricePerKwh;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        sum += value;
        count += 1;
      } else if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
          sum += parsed;
          count += 1;
        }
      }
    }

    if (count === 0) {
      return 0;
    }

    return Number((sum / count).toFixed(4));
  }
}
