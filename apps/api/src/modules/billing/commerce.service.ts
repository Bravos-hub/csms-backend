import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '@app/db';
import { PaymentIntent, PaymentMethod, Prisma, Wallet } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from '../payment-methods/dto/payment-methods.dto';
import {
  CreatePaymentIntentDto,
  GuestCheckoutDto,
  ReconcilePaymentIntentDto,
  WalletDebitDto,
  WalletRefundDto,
  WalletTopUpDto,
  WalletTransactionQueryDto,
  WalletTransferDto,
} from '../wallet/dto/wallet.dto';

type WalletResponse = {
  id: string;
  userId: string;
  organizationId: string | null;
  balance: number;
  currency: string;
  isLocked: boolean;
  lockReason: string | null;
  lockedAt: string | null;
  updatedAt: string;
};

type PaymentMethodResponse = {
  id: string;
  type: string;
  provider: string | null;
  label: string;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  status: string;
  isDefault: boolean;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

type PaymentIntentResponse = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  idempotencyKey: string;
  correlationId: string | null;
  reconciliationState: string;
  checkoutUrl: string | null;
  checkoutQrPayload: string | null;
  providerReference: string | null;
  expiresAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly configService: ConfigService,
  ) {}

  async listPaymentMethods(
    userId: string,
    includeInactive = false,
  ): Promise<PaymentMethodResponse[]> {
    await this.resolveUserForScope(userId);
    const methods = await this.prisma.paymentMethod.findMany({
      where: {
        userId,
        ...(includeInactive ? {} : { status: 'ACTIVE' }),
      },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return methods.map((method) => this.mapPaymentMethod(method));
  }

  async createPaymentMethod(
    userId: string,
    dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    const user = await this.resolveUserForScope(userId);
    const type = this.normalizePaymentMethodType(dto.type);
    const tokenRef = this.requiredTrimmed(dto.tokenRef, 'tokenRef');

    const method = await this.prisma.$transaction(async (tx) => {
      if (dto.setDefault) {
        await tx.paymentMethod.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.paymentMethod.create({
        data: {
          userId,
          organizationId: user.organizationId,
          type,
          provider: this.optionalTrimmed(dto.provider),
          label:
            this.optionalTrimmed(dto.label) ||
            this.defaultPaymentMethodLabel(type, dto.last4),
          tokenRef,
          last4: this.sanitizeLast4(dto.last4),
          expiryMonth: dto.expiryMonth ?? null,
          expiryYear: dto.expiryYear ?? null,
          status: 'ACTIVE',
          isDefault: Boolean(dto.setDefault),
          metadata: dto.metadata
            ? (dto.metadata as Prisma.InputJsonValue)
            : undefined,
        },
      });
    });

    return this.mapPaymentMethod(method);
  }

  async updatePaymentMethod(
    userId: string,
    methodId: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    const existing = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Payment method not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.setDefault) {
        await tx.paymentMethod.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const next = await tx.paymentMethod.update({
        where: { id: existing.id },
        data: {
          status: dto.status
            ? this.normalizePaymentMethodStatus(dto.status)
            : undefined,
          provider: this.nullableOptionalTrimmed(dto.provider),
          label: this.optionalTrimmed(dto.label),
          tokenRef: this.optionalTrimmed(dto.tokenRef),
          last4: dto.last4 ? this.sanitizeLast4(dto.last4) : undefined,
          expiryMonth: dto.expiryMonth,
          expiryYear: dto.expiryYear,
          isDefault: dto.setDefault === true,
          metadata:
            dto.metadata !== undefined
              ? (dto.metadata as Prisma.InputJsonValue)
              : undefined,
        },
      });

      if (next.status === 'REVOKED' && next.isDefault) {
        await tx.paymentMethod.update({
          where: { id: next.id },
          data: { isDefault: false },
        });
      }

      return tx.paymentMethod.findUnique({ where: { id: next.id } });
    });

    if (!updated) {
      throw new NotFoundException('Payment method not found');
    }

    return this.mapPaymentMethod(updated);
  }

  async revokePaymentMethod(userId: string, methodId: string): Promise<void> {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, userId },
    });
    if (!method) {
      throw new NotFoundException('Payment method not found');
    }

    await this.prisma.paymentMethod.update({
      where: { id: method.id },
      data: { status: 'REVOKED', isDefault: false },
    });
  }

  async setDefaultPaymentMethod(
    userId: string,
    methodId: string,
  ): Promise<PaymentMethodResponse> {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, userId },
    });
    if (!method) {
      throw new NotFoundException('Payment method not found');
    }
    if (method.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only ACTIVE payment methods can be set as default',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.paymentMethod.update({
        where: { id: method.id },
        data: { isDefault: true },
      });
    });

    const updated = await this.prisma.paymentMethod.findUnique({
      where: { id: method.id },
    });
    if (!updated) {
      throw new NotFoundException('Payment method not found');
    }

    return this.mapPaymentMethod(updated);
  }

  async getWallet(userId: string): Promise<WalletResponse> {
    const wallet = await this.ensureWallet(userId);
    return this.mapWallet(wallet);
  }

  async getWalletTransactions(
    userId: string,
    query: WalletTransactionQueryDto,
  ): Promise<
    Array<{
      id: string;
      amount: number;
      type: string;
      status: string;
      reconciliationState: string;
      reference: string | null;
      correlationId: string | null;
      idempotencyKey: string | null;
      occurredAt: string;
      createdAt: string;
    }>
  > {
    const wallet = await this.ensureWallet(userId);
    const take = Math.min(Math.max(query.limit || 50, 1), 200);
    const skip = Math.max(query.offset || 0, 0);

    const rows = await this.prisma.transaction.findMany({
      where: {
        walletId: wallet.id,
        ...(query.status?.trim()
          ? { status: query.status.trim().toUpperCase() }
          : {}),
        ...(query.type?.trim()
          ? { type: query.type.trim().toUpperCase() }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      type: row.type,
      status: row.status,
      reconciliationState: row.reconciliationState,
      reference: row.reference,
      correlationId: row.correlationId,
      idempotencyKey: row.idempotencyKey,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async topUp(
    userId: string,
    dto: WalletTopUpDto,
  ): Promise<{
    wallet: WalletResponse;
    paymentIntent: PaymentIntentResponse;
    transactionId: string;
  }> {
    const wallet = await this.ensureWallet(userId, dto.currency);
    this.assertWalletUnlocked(wallet);
    const paymentMethod = dto.paymentMethodId
      ? await this.loadActivePaymentMethod(userId, dto.paymentMethodId)
      : null;
    const amount = this.normalizeAmount(dto.amount, 'amount');
    const currency = this.normalizeCurrencyCode(dto.currency, wallet.currency);
    const meta = this.normalizeIntentMeta(
      dto.idempotencyKey,
      dto.correlationId,
    );

    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: meta.idempotencyKey },
      include: {
        transactions: {
          select: { id: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (existing) {
      return {
        wallet: this.mapWallet(await this.ensureWallet(userId)),
        paymentIntent: this.mapPaymentIntent(existing),
        transactionId: existing.transactions[0]?.id || existing.id,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const intent = await tx.paymentIntent.create({
        data: {
          userId,
          organizationId: wallet.organizationId,
          walletId: wallet.id,
          paymentMethodId: paymentMethod?.id || null,
          amount,
          currency,
          status: 'SETTLED',
          idempotencyKey: meta.idempotencyKey,
          correlationId: meta.correlationId,
          reconciliationState: 'RECONCILED',
          settledAt: new Date(),
          expiresAt: meta.expiresAt,
          metadata: dto.note
            ? ({ note: dto.note } as Prisma.InputJsonValue)
            : undefined,
        },
      });

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount }, currency },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          paymentIntentId: intent.id,
          amount,
          type: 'CREDIT',
          status: 'POSTED',
          reconciliationState: 'RECONCILED',
          description: dto.note || 'Wallet top-up',
          reference: `TOPUP_${Date.now()}`,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          occurredAt: new Date(),
        },
      });

      return { updatedWallet, intent, transactionId: transaction.id };
    });

    return {
      wallet: this.mapWallet(result.updatedWallet),
      paymentIntent: this.mapPaymentIntent(result.intent),
      transactionId: result.transactionId,
    };
  }

  async debit(
    userId: string,
    dto: WalletDebitDto,
  ): Promise<{
    wallet: WalletResponse;
    transactionId: string;
  }> {
    const wallet = await this.ensureWallet(userId);
    this.assertWalletUnlocked(wallet);
    const amount = this.normalizeAmount(dto.amount, 'amount');
    if (wallet.balance < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const meta = this.normalizeIntentMeta(
      dto.idempotencyKey,
      dto.correlationId,
    );
    const existing = await this.prisma.transaction.findFirst({
      where: { walletId: wallet.id, idempotencyKey: meta.idempotencyKey },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        wallet: this.mapWallet(await this.ensureWallet(userId)),
        transactionId: existing.id,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount,
          type: 'DEBIT',
          status: 'POSTED',
          reconciliationState: 'RECONCILED',
          description: dto.note || 'Wallet debit',
          reference: dto.reference || `DEBIT_${Date.now()}`,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          occurredAt: new Date(),
        },
        select: { id: true },
      });

      return { updatedWallet, transactionId: transaction.id };
    });

    return {
      wallet: this.mapWallet(result.updatedWallet),
      transactionId: result.transactionId,
    };
  }

  async refund(
    userId: string,
    dto: WalletRefundDto,
  ): Promise<{
    wallet: WalletResponse;
    transactionId: string;
  }> {
    const wallet = await this.ensureWallet(userId);
    this.assertWalletUnlocked(wallet);
    const amount = this.normalizeAmount(dto.amount, 'amount');
    const meta = this.normalizeIntentMeta(
      dto.idempotencyKey,
      dto.correlationId,
    );

    const existing = await this.prisma.transaction.findFirst({
      where: { walletId: wallet.id, idempotencyKey: meta.idempotencyKey },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        wallet: this.mapWallet(await this.ensureWallet(userId)),
        transactionId: existing.id,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          amount,
          type: 'REFUND',
          status: 'POSTED',
          reconciliationState: 'RECONCILED',
          description: dto.note || 'Wallet refund',
          reference: dto.reference || `REFUND_${Date.now()}`,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          occurredAt: new Date(),
        },
        select: { id: true },
      });

      return { updatedWallet, transactionId: transaction.id };
    });

    return {
      wallet: this.mapWallet(result.updatedWallet),
      transactionId: result.transactionId,
    };
  }

  async transfer(
    userId: string,
    dto: WalletTransferDto,
  ): Promise<{
    sourceWallet: WalletResponse;
    targetWallet: WalletResponse;
    debitTransactionId: string;
    creditTransactionId: string;
  }> {
    const sourceWallet = await this.ensureWallet(userId);
    this.assertWalletUnlocked(sourceWallet);
    const targetUser = await this.resolveUserForScope(dto.targetUserId);
    const targetWallet = await this.ensureWallet(
      targetUser.id,
      sourceWallet.currency,
    );
    this.assertWalletUnlocked(targetWallet);

    const amount = this.normalizeAmount(dto.amount, 'amount');
    if (sourceWallet.balance < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const meta = this.normalizeIntentMeta(
      dto.idempotencyKey,
      dto.correlationId,
    );
    const existing = await this.prisma.transaction.findFirst({
      where: {
        walletId: sourceWallet.id,
        idempotencyKey: meta.idempotencyKey,
        type: 'DEBIT',
      },
      select: { id: true, reference: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        sourceWallet: this.mapWallet(await this.ensureWallet(userId)),
        targetWallet: this.mapWallet(await this.ensureWallet(targetUser.id)),
        debitTransactionId: existing.id,
        creditTransactionId: existing.reference || existing.id,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedSource = await tx.wallet.update({
        where: { id: sourceWallet.id },
        data: { balance: { decrement: amount } },
      });
      const updatedTarget = await tx.wallet.update({
        where: { id: targetWallet.id },
        data: { balance: { increment: amount } },
      });

      const debit = await tx.transaction.create({
        data: {
          walletId: sourceWallet.id,
          amount,
          type: 'DEBIT',
          status: 'POSTED',
          reconciliationState: 'RECONCILED',
          description: dto.note || `Transfer to ${targetUser.id}`,
          reference: `XFER_CREDIT_${Date.now()}`,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          occurredAt: new Date(),
        },
        select: { id: true },
      });

      const credit = await tx.transaction.create({
        data: {
          walletId: targetWallet.id,
          amount,
          type: 'CREDIT',
          status: 'POSTED',
          reconciliationState: 'RECONCILED',
          description: dto.note || `Transfer from ${userId}`,
          reference: `XFER_DEBIT_${Date.now()}`,
          correlationId: meta.correlationId,
          idempotencyKey: `${meta.idempotencyKey}:credit`,
          occurredAt: new Date(),
        },
        select: { id: true },
      });

      return { updatedSource, updatedTarget, debit, credit };
    });

    return {
      sourceWallet: this.mapWallet(result.updatedSource),
      targetWallet: this.mapWallet(result.updatedTarget),
      debitTransactionId: result.debit.id,
      creditTransactionId: result.credit.id,
    };
  }

  async lockWallet(userId: string, reason?: string): Promise<WalletResponse> {
    const wallet = await this.ensureWallet(userId);
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        isLocked: true,
        lockReason: this.optionalTrimmed(reason) || 'Operator lock',
        lockedAt: new Date(),
      },
    });
    return this.mapWallet(updated);
  }

  async unlockWallet(userId: string): Promise<WalletResponse> {
    const wallet = await this.ensureWallet(userId);
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        isLocked: false,
        lockReason: null,
        lockedAt: null,
      },
    });
    return this.mapWallet(updated);
  }

  async createPaymentIntent(
    userId: string,
    dto: CreatePaymentIntentDto,
  ): Promise<PaymentIntentResponse> {
    const wallet = await this.ensureWallet(userId, dto.currency);
    this.assertWalletUnlocked(wallet);
    const paymentMethod = dto.paymentMethodId
      ? await this.loadActivePaymentMethod(userId, dto.paymentMethodId)
      : null;
    const meta = this.normalizeIntentMeta(
      dto.idempotencyKey,
      dto.correlationId,
      dto.ttlMinutes,
    );

    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: meta.idempotencyKey },
    });
    if (existing) {
      return this.mapPaymentIntent(existing);
    }

    const created = await this.prisma.paymentIntent.create({
      data: {
        userId,
        organizationId: wallet.organizationId,
        walletId: wallet.id,
        paymentMethodId: paymentMethod?.id || null,
        invoiceId: this.optionalTrimmed(dto.invoiceId),
        sessionId: this.optionalTrimmed(dto.sessionId),
        amount: this.normalizeAmount(dto.amount, 'amount'),
        currency: this.normalizeCurrencyCode(dto.currency, wallet.currency),
        status: 'PENDING',
        idempotencyKey: meta.idempotencyKey,
        correlationId: meta.correlationId,
        reconciliationState: 'RECONCILING',
        checkoutUrl: meta.checkoutUrl,
        checkoutQrPayload: meta.checkoutQrPayload,
        expiresAt: meta.expiresAt,
        metadata: dto.metadata
          ? (dto.metadata as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return this.mapPaymentIntent(created);
  }

  async createGuestCheckoutIntent(dto: GuestCheckoutDto): Promise<{
    paymentIntent: PaymentIntentResponse;
    deepLink: string;
    qrPayload: string;
  }> {
    const meta = this.normalizeIntentMeta(
      dto.idempotencyKey,
      dto.correlationId,
      dto.ttlMinutes,
    );
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: meta.idempotencyKey },
    });
    if (existing) {
      return {
        paymentIntent: this.mapPaymentIntent(existing),
        deepLink: existing.checkoutUrl || meta.checkoutUrl,
        qrPayload: existing.checkoutQrPayload || meta.checkoutQrPayload,
      };
    }

    const created = await this.prisma.paymentIntent.create({
      data: {
        organizationId: this.resolveTenantId(),
        amount: this.normalizeAmount(dto.amount, 'amount'),
        currency: this.normalizeCurrencyCode(dto.currency),
        status: 'PENDING',
        idempotencyKey: meta.idempotencyKey,
        correlationId: meta.correlationId,
        reconciliationState: 'RECONCILING',
        checkoutUrl: meta.checkoutUrl,
        checkoutQrPayload: meta.checkoutQrPayload,
        expiresAt: meta.expiresAt,
        sessionId: this.optionalTrimmed(dto.sessionId),
        invoiceId: this.optionalTrimmed(dto.invoiceId),
        metadata: {
          callbackUrl: this.optionalTrimmed(dto.callbackUrl),
          ...(dto.metadata || {}),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      paymentIntent: this.mapPaymentIntent(created),
      deepLink: created.checkoutUrl || meta.checkoutUrl,
      qrPayload: created.checkoutQrPayload || meta.checkoutQrPayload,
    };
  }

  async reconcilePaymentIntent(
    intentId: string,
    dto: ReconcilePaymentIntentDto,
  ): Promise<PaymentIntentResponse> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });
    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }
    this.assertIntentInScope(intent);

    const status = this.normalizePaymentIntentStatus(dto.status);
    const markSettled = Boolean(dto.markSettled) || status === 'SETTLED';

    const updated = await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status,
        providerReference: this.nullableOptionalTrimmed(dto.providerReference),
        settledAt: markSettled ? new Date() : intent.settledAt,
        reconciliationState:
          status === 'FAILED' || status === 'CANCELED'
            ? 'DISPUTED'
            : markSettled
              ? 'RECONCILED'
              : 'RECONCILING',
        metadata: dto.note
          ? ({
              ...(this.toRecord(intent.metadata) || {}),
              reconciliationNote: dto.note,
            } as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return this.mapPaymentIntent(updated);
  }

  async getPaymentIntent(id: string): Promise<PaymentIntentResponse | null> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id },
    });
    if (!intent) {
      return null;
    }
    this.assertIntentInScope(intent);
    return this.mapPaymentIntent(intent);
  }

  private resolveTenantId(): string | null {
    const context = this.tenantContext.get();
    return (
      context?.effectiveOrganizationId ||
      context?.authenticatedOrganizationId ||
      null
    );
  }

  private async resolveUserForScope(userId: string): Promise<{
    id: string;
    organizationId: string | null;
  }> {
    const normalizedUserId = this.requiredTrimmed(userId, 'userId');
    const user = await this.prisma.user.findUnique({
      where: { id: normalizedUserId },
      select: { id: true, organizationId: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const tenantId = this.resolveTenantId();
    if (tenantId && user.organizationId !== tenantId) {
      throw new ForbiddenException('User is outside the active tenant scope');
    }
    return user;
  }

  private async ensureWallet(
    userId: string,
    currencyHint?: string,
  ): Promise<Wallet> {
    const user = await this.resolveUserForScope(userId);
    const current = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!current) {
      return this.prisma.wallet.create({
        data: {
          userId,
          organizationId: user.organizationId,
          currency: this.normalizeCurrencyCode(currencyHint),
          balance: 0,
          isLocked: false,
        },
      });
    }

    const preferredCurrency =
      current.balance === 0 && currencyHint
        ? this.normalizeCurrencyCode(currencyHint, current.currency)
        : current.currency;
    if (
      current.organizationId !== user.organizationId ||
      preferredCurrency !== current.currency
    ) {
      return this.prisma.wallet.update({
        where: { id: current.id },
        data: {
          organizationId: user.organizationId,
          currency: preferredCurrency,
        },
      });
    }
    return current;
  }

  private assertWalletUnlocked(wallet: Wallet): void {
    if (wallet.isLocked) {
      throw new ForbiddenException(
        `Wallet is locked${wallet.lockReason ? `: ${wallet.lockReason}` : ''}`,
      );
    }
  }

  private async loadActivePaymentMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<PaymentMethod> {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });
    if (!method) {
      throw new NotFoundException('Payment method not found');
    }
    if (method.status !== 'ACTIVE') {
      throw new BadRequestException('Payment method is not active');
    }
    return method;
  }

  private normalizeIntentMeta(
    idempotencyKey?: string,
    correlationId?: string,
    ttlMinutes?: number,
  ): {
    idempotencyKey: string;
    correlationId: string;
    checkoutUrl: string;
    checkoutQrPayload: string;
    expiresAt: Date;
  } {
    const normalizedIdempotency =
      this.optionalTrimmed(idempotencyKey) ||
      `pi_${randomUUID().replace(/-/g, '')}`;
    const normalizedCorrelation =
      this.optionalTrimmed(correlationId) ||
      `corr_${randomUUID().replace(/-/g, '')}`;
    const ttl =
      typeof ttlMinutes === 'number' &&
      Number.isFinite(ttlMinutes) &&
      ttlMinutes > 0
        ? Math.floor(ttlMinutes)
        : 30;
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
    const checkoutUrl = this.buildCheckoutUrl(
      `/pay/checkout/${normalizedIdempotency}`,
    );
    const checkoutQrPayload = `evzone://checkout?intent=${encodeURIComponent(normalizedIdempotency)}&corr=${encodeURIComponent(normalizedCorrelation)}`;

    return {
      idempotencyKey: normalizedIdempotency,
      correlationId: normalizedCorrelation,
      checkoutUrl,
      checkoutQrPayload,
      expiresAt,
    };
  }

  private mapWallet(wallet: Wallet): WalletResponse {
    return {
      id: wallet.id,
      userId: wallet.userId,
      organizationId: wallet.organizationId,
      balance: wallet.balance,
      currency: wallet.currency,
      isLocked: wallet.isLocked,
      lockReason: wallet.lockReason,
      lockedAt: wallet.lockedAt ? wallet.lockedAt.toISOString() : null,
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  private mapPaymentMethod(method: PaymentMethod): PaymentMethodResponse {
    return {
      id: method.id,
      type: method.type,
      provider: method.provider,
      label: method.label,
      last4: method.last4,
      expiryMonth: method.expiryMonth,
      expiryYear: method.expiryYear,
      status: method.status,
      isDefault: method.isDefault,
      metadata: method.metadata,
      createdAt: method.createdAt.toISOString(),
      updatedAt: method.updatedAt.toISOString(),
    };
  }

  private mapPaymentIntent(intent: PaymentIntent): PaymentIntentResponse {
    return {
      id: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status,
      idempotencyKey: intent.idempotencyKey,
      correlationId: intent.correlationId,
      reconciliationState: intent.reconciliationState,
      checkoutUrl: intent.checkoutUrl,
      checkoutQrPayload: intent.checkoutQrPayload,
      providerReference: intent.providerReference,
      expiresAt: intent.expiresAt ? intent.expiresAt.toISOString() : null,
      settledAt: intent.settledAt ? intent.settledAt.toISOString() : null,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
    };
  }

  private assertIntentInScope(intent: PaymentIntent): void {
    const tenantId = this.resolveTenantId();
    if (
      tenantId &&
      intent.organizationId &&
      intent.organizationId !== tenantId
    ) {
      throw new ForbiddenException(
        'Payment intent is outside the active tenant scope',
      );
    }
  }

  private normalizeAmount(value: number, field: string): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive number`);
    }
    return Number(value.toFixed(4));
  }

  private normalizeCurrencyCode(value?: string, fallback = 'USD'): string {
    const normalized = (value || fallback).trim().toUpperCase();
    if (normalized.length < 3 || normalized.length > 4) {
      throw new BadRequestException('currency must be a valid code');
    }
    return normalized;
  }

  private normalizePaymentMethodType(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (
      ![
        'CARD',
        'MOBILE_MONEY',
        'BANK_TRANSFER',
        'WALLET',
        'QR_HOSTED',
      ].includes(normalized)
    ) {
      throw new BadRequestException('Unsupported payment method type');
    }
    return normalized;
  }

  private normalizePaymentMethodStatus(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!['ACTIVE', 'INACTIVE', 'REVOKED'].includes(normalized)) {
      throw new BadRequestException('Unsupported payment method status');
    }
    return normalized;
  }

  private normalizePaymentIntentStatus(value: string): PaymentIntent['status'] {
    const normalized = value.trim().toUpperCase();
    if (
      ![
        'PENDING',
        'AUTHORIZED',
        'SETTLED',
        'FAILED',
        'CANCELED',
        'EXPIRED',
      ].includes(normalized)
    ) {
      throw new BadRequestException('Unsupported payment intent status');
    }
    return normalized;
  }

  private defaultPaymentMethodLabel(type: string, last4?: string): string {
    const suffix = this.sanitizeLast4(last4);
    return suffix
      ? `${type.replace('_', ' ')} •••• ${suffix}`
      : type.replace('_', ' ');
  }

  private sanitizeLast4(value?: string): string | null {
    const candidate = this.optionalTrimmed(value);
    if (!candidate) return null;
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 4) {
      throw new BadRequestException('last4 must contain at least four digits');
    }
    return digits.slice(-4);
  }

  private buildCheckoutUrl(path: string): string {
    const baseUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'https://portal.evzonecharging.com';
    const normalizedBase = baseUrl.endsWith('/')
      ? baseUrl.slice(0, -1)
      : baseUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private requiredTrimmed(value: string, field: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }
    return trimmed;
  }

  private optionalTrimmed(value?: string): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private nullableOptionalTrimmed(value?: string): string | null | undefined {
    if (value === undefined) return undefined;
    return this.optionalTrimmed(value) || null;
  }

  private toRecord(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }
}
