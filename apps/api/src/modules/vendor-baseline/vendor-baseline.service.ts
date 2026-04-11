import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { MembershipStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { CommerceService } from '../billing/commerce.service';
import {
  AutochargeEnrollmentDto,
  DriverWorkflowQueryDto,
  LoyaltyTransactionDto,
  OpenAdrEventDto,
  OpenAdrSettingsDto,
  RoamingPartnerProtocolsDto,
  SmartQueueQueryDto,
  TerminalCheckoutIntentDto,
  TerminalIntentReconcileDto,
  TerminalRegistrationDto,
  V2xProfileUpsertDto,
} from './dto/vendor-baseline.dto';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const SUPPORTED_ROAMING_PROTOCOLS = ['OCPI', 'OCHP', 'OICP', 'EMIP'] as const;

type SupportedRoamingProtocol = (typeof SUPPORTED_ROAMING_PROTOCOLS)[number];

type LoyaltyState = {
  points: number;
  tier: string;
  history: Record<string, unknown>[];
};

@Injectable()
export class VendorBaselineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly commerce: CommerceService,
  ) {}

  async getOverview(actorId: string): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const [
      openadrFlag,
      partners,
      derProfiles,
      queueCount,
      autochargeCount,
      intents,
      drivers,
    ] = await Promise.all([
      this.prisma.featureFlag.findUnique({
        where: { key: 'openadr_v1' },
        select: { isEnabled: true, rules: true },
      }),
      this.prisma.ocpiPartner.findMany({ select: { roles: true } }),
      this.prisma.energyDerProfile.findMany({
        where: { tenantId },
        select: { metadata: true },
      }),
      this.prisma.booking.count({
        where: { status: { in: ['PENDING', 'CONFIRMED'] } },
      }),
      this.prisma.fleetDriverToken.count({
        where: {
          organizationId: tenantId,
          tokenType: 'AUTOCHARGE',
          status: 'ACTIVE',
        },
      }),
      this.prisma.paymentIntent.findMany({
        where: { organizationId: tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, metadata: true },
      }),
      this.prisma.fleetDriver.findMany({
        where: { organizationId: tenantId },
        select: {
          userId: true,
          metadata: true,
          tokens: {
            where: { status: 'ACTIVE' },
            select: { id: true },
          },
        },
      }),
    ]);

    const protocols = new Set<SupportedRoamingProtocol>();
    for (const partner of partners) {
      const roles = this.readRecord(partner.roles);
      const configured = this.readStringArray(roles.protocols)
        .map((value) => value.toUpperCase())
        .filter((value): value is SupportedRoamingProtocol =>
          (SUPPORTED_ROAMING_PROTOCOLS as readonly string[]).includes(value),
        );
      if (configured.length === 0) {
        protocols.add('OCPI');
      } else {
        configured.forEach((protocol) => protocols.add(protocol));
      }
    }

    const v2xReadyCount = derProfiles.filter((profile) => {
      const metadata = this.readRecord(profile.metadata);
      const v2x = this.readRecord(metadata.v2x);
      return this.readBoolean(v2x.enabled) === true;
    }).length;

    const terminalIntentCount = intents.filter((intent) => {
      const metadata = this.readRecord(intent.metadata);
      return this.readString(metadata.channel)?.toUpperCase() === 'TERMINAL';
    }).length;

    let loyaltyDriverCount = 0;
    let driverWorkflowReadyCount = 0;
    for (const driver of drivers) {
      const loyalty = this.extractLoyaltyState(driver.metadata);
      if (loyalty.points > 0) loyaltyDriverCount += 1;
      if (this.optionalTrimmed(driver.userId) && driver.tokens.length > 0) {
        driverWorkflowReadyCount += 1;
      }
    }

    return {
      tenantId,
      generatedAt: new Date().toISOString(),
      metrics: {
        openAdrEnabled: openadrFlag?.isEnabled ?? false,
        roamingProtocols: Array.from(protocols.values()),
        v2xReadyCount,
        autochargeCount,
        smartQueueCount: queueCount,
        terminalIntentCount,
        loyaltyDriverCount,
        driverWorkflowReadyCount,
      },
    };
  }

  async upsertOpenAdrSettings(
    actorId: string,
    dto: OpenAdrSettingsDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const flag = await this.ensureFeatureFlag(
      'openadr_v1',
      'OpenADR vendor-baseline settings',
    );

    const currentRules = this.readRecord(flag.rules);
    const rules: Record<string, unknown> = {
      ...currentRules,
      venId: this.optionalTrimmed(dto.venId),
      programName: this.optionalTrimmed(dto.programName),
      marketContext: this.optionalTrimmed(dto.marketContext),
      responseMode: this.optionalTrimmed(dto.responseMode),
      defaultDurationMinutes: dto.defaultDurationMinutes ?? 60,
      signalName: this.optionalTrimmed(dto.signalName) || 'SIMPLE',
      signalType: this.optionalTrimmed(dto.signalType) || 'level',
      priority: dto.priority ?? 0,
      targetStationIds: this.normalizeStringArray(dto.targetStationIds),
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.featureFlag.update({
      where: { key: flag.key },
      data: {
        isEnabled: dto.enabled,
        rules: rules as Prisma.InputJsonValue,
      },
      select: {
        key: true,
        isEnabled: true,
        rules: true,
      },
    });

    return {
      key: updated.key,
      enabled: updated.isEnabled,
      settings: this.readRecord(updated.rules),
    };
  }

  async ingestOpenAdrEvent(
    actorId: string,
    dto: OpenAdrEventDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const station = await this.assertStationInTenant(dto.stationId, tenantId);
    const startsAt = this.parseIsoDate(dto.startsAt, 'startsAt');
    const endsAt = this.parseIsoDate(dto.endsAt, 'endsAt');

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    const eventId =
      this.optionalTrimmed(dto.eventId) ||
      `openadr-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const schedule = await this.prisma.energyManagementSchedule.create({
      data: {
        tenantId,
        stationId: station.id,
        status: 'PENDING_APPROVAL',
        source: 'OPENADR',
        startsAt,
        endsAt,
        fallbackToDlm: true,
        notes: this.optionalTrimmed(dto.reason) || `OpenADR event ${eventId}`,
        entries: [
          {
            eventId,
            signalName: this.optionalTrimmed(dto.signalName) || 'SIMPLE',
            signalType: this.optionalTrimmed(dto.signalType) || 'level',
            signalValueKw: Number(dto.signalValueKw.toFixed(4)),
            priority: dto.priority ?? 0,
          },
        ] as Prisma.InputJsonValue,
        createdBy: actorId,
      },
      select: {
        id: true,
        stationId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        entries: true,
      },
    });

    const run = await this.prisma.energyPlanRun.create({
      data: {
        tenantId,
        stationId: station.id,
        scheduleId: schedule.id,
        trigger: 'openadr-event',
        state: 'QUEUED',
        message: `Queued OpenADR event ${eventId}`,
        initiatedBy: actorId,
      },
      select: { id: true, state: true, startedAt: true },
    });

    return {
      schedule: {
        ...schedule,
        startsAt: schedule.startsAt.toISOString(),
        endsAt: schedule.endsAt.toISOString(),
      },
      run: {
        ...run,
        startedAt: run.startedAt.toISOString(),
      },
    };
  }

  async updateRoamingPartnerProtocols(
    actorId: string,
    partnerId: string,
    dto: RoamingPartnerProtocolsDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const partner = await this.prisma.ocpiPartner.findUnique({
      where: { id: this.requiredTrimmed(partnerId, 'partnerId') },
      select: { id: true, name: true, roles: true, updatedAt: true },
    });

    if (!partner) {
      throw new NotFoundException('Roaming partner not found');
    }

    const protocols = this.normalizeProtocols(dto.protocols);
    const currentRoles = this.readRecord(partner.roles);

    const roles: Record<string, unknown> = {
      ...currentRoles,
      protocols,
      transport: this.optionalTrimmed(dto.transport) || 'HTTPS',
      endpointOverrides: dto.endpointOverrides || {},
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.ocpiPartner.update({
      where: { id: partner.id },
      data: { roles: roles as Prisma.InputJsonValue },
      select: { id: true, name: true, roles: true, updatedAt: true },
    });

    return {
      id: updated.id,
      name: updated.name,
      protocols,
      roles: this.readRecord(updated.roles),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async upsertStationV2xProfile(
    actorId: string,
    stationId: string,
    dto: V2xProfileUpsertDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const station = await this.assertStationInTenant(stationId, tenantId);

    const current = await this.prisma.energyDerProfile.findUnique({
      where: {
        tenantId_stationId: {
          tenantId,
          stationId: station.id,
        },
      },
    });

    const currentMetadata = this.readRecord(current?.metadata);
    const v2x: Record<string, unknown> = {
      enabled: dto.enabled,
      mode: dto.mode,
      maxDischargeKw: dto.maxDischargeKw ?? null,
      minSocPercent: dto.minSocPercent ?? null,
      bidirectionalDispatch: dto.bidirectionalDispatch ?? false,
      provider: this.optionalTrimmed(dto.provider),
      notes: this.optionalTrimmed(dto.notes),
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
    };

    const metadata: Record<string, unknown> = {
      ...currentMetadata,
      v2x,
      v2xEnabled: dto.enabled,
    };

    const profile = await this.prisma.energyDerProfile.upsert({
      where: {
        tenantId_stationId: {
          tenantId,
          stationId: station.id,
        },
      },
      create: {
        tenantId,
        organizationId: tenantId,
        stationId: station.id,
        siteId: station.siteId,
        status: 'ACTIVE',
        bessEnabled: dto.enabled,
        maxBessDischargeKw: dto.maxDischargeKw ?? null,
        metadata: metadata as Prisma.InputJsonValue,
        createdBy: actorId,
        updatedBy: actorId,
      },
      update: {
        bessEnabled: dto.enabled || current?.bessEnabled || false,
        maxBessDischargeKw:
          dto.maxDischargeKw ?? current?.maxBessDischargeKw ?? null,
        metadata: metadata as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
      select: {
        id: true,
        stationId: true,
        status: true,
        metadata: true,
        updatedAt: true,
      },
    });

    return {
      id: profile.id,
      stationId: profile.stationId,
      status: profile.status,
      metadata: this.readRecord(profile.metadata),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async enrollAutocharge(
    actorId: string,
    dto: AutochargeEnrollmentDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const driverId = this.requiredTrimmed(dto.driverId, 'driverId');
    const tokenUid = this.requiredTrimmed(
      dto.tokenUid,
      'tokenUid',
    ).toUpperCase();

    const driver = await this.prisma.fleetDriver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        displayName: true,
      },
    });

    if (!driver || driver.organizationId !== tenantId) {
      throw new NotFoundException('Fleet driver not found in tenant scope');
    }

    const metadata: Record<string, unknown> = {
      protocol: 'AUTOCHARGE',
      vehicleId: this.optionalTrimmed(dto.vehicleId),
      vehicleVin: this.optionalTrimmed(dto.vehicleVin),
      chargePointId: this.optionalTrimmed(dto.chargePointId),
      connectorId: dto.connectorId ?? null,
      enrolledBy: actorId,
      enrolledAt: new Date().toISOString(),
      ...(dto.metadata || {}),
    };

    const existing = await this.prisma.fleetDriverToken.findUnique({
      where: {
        organizationId_tokenUid_tokenType: {
          organizationId: tenantId,
          tokenUid,
          tokenType: 'AUTOCHARGE',
        },
      },
      select: { id: true, driverId: true },
    });

    if (existing && existing.driverId !== driver.id) {
      throw new BadRequestException(
        'Autocharge token is already assigned to another driver',
      );
    }

    const enrollment = existing
      ? await this.prisma.fleetDriverToken.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            revokedAt: null,
            metadata: metadata as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            tokenUid: true,
            tokenType: true,
            status: true,
            assignedAt: true,
            metadata: true,
          },
        })
      : await this.prisma.fleetDriverToken.create({
          data: {
            organizationId: tenantId,
            driverId: driver.id,
            tokenUid,
            tokenType: 'AUTOCHARGE',
            status: 'ACTIVE',
            metadata: metadata as Prisma.InputJsonValue,
            createdBy: actorId,
          },
          select: {
            id: true,
            tokenUid: true,
            tokenType: true,
            status: true,
            assignedAt: true,
            metadata: true,
          },
        });

    return {
      ...enrollment,
      assignedAt: enrollment.assignedAt.toISOString(),
      driver,
      metadata: this.readRecord(enrollment.metadata),
    };
  }

  async getSmartQueue(
    actorId: string,
    query: SmartQueueQueryDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const limit = query.limit ?? 30;

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        ...(this.optionalTrimmed(query.stationId)
          ? {
              stationId: this.requiredTrimmed(
                query.stationId || '',
                'stationId',
              ),
            }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        station: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
      take: limit * 4,
    });

    const now = Date.now();

    const ranked = bookings
      .map((booking) => {
        let score = 0;
        const reasons: string[] = [];

        if (booking.status === 'CONFIRMED') {
          score += 20;
          reasons.push('confirmed');
        }

        const startsInMinutes = Math.floor(
          (booking.startTime.getTime() - now) / 60_000,
        );
        if (startsInMinutes <= 0) {
          score += 15;
          reasons.push('start-time reached');
        } else if (startsInMinutes <= 15) {
          score += 12;
          reasons.push('starts within 15m');
        } else if (startsInMinutes <= 30) {
          score += 8;
          reasons.push('starts within 30m');
        }

        if ((booking.requiredKwh || 0) >= 40) {
          score += 4;
          reasons.push('high energy request');
        }

        if (booking.reservationCommandStatus === 'Failed') {
          score -= 10;
          reasons.push('command failure penalty');
        }

        return {
          bookingId: booking.id,
          reservationId: booking.reservationId,
          stationId: booking.station.id,
          stationName: booking.station.name,
          userId: booking.user.id,
          userName: booking.user.name,
          status: booking.status,
          startTime: booking.startTime.toISOString(),
          endTime: booking.endTime.toISOString(),
          score,
          reasons,
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return (
          new Date(left.startTime).getTime() -
          new Date(right.startTime).getTime()
        );
      })
      .slice(0, limit);

    return {
      tenantId,
      generatedAt: new Date().toISOString(),
      count: ranked.length,
      items: ranked,
    };
  }

  async registerPaymentTerminal(
    actorId: string,
    dto: TerminalRegistrationDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const terminalId = this.requiredTrimmed(
      dto.terminalId,
      'terminalId',
    ).toUpperCase();

    const flag = await this.ensureFeatureFlag(
      'payment_terminal_v1',
      'Payment terminal vendor-baseline settings',
    );

    const currentRules = this.readRecord(flag.rules);
    const currentTerminals = this.readTerminalRegistry(flag.rules);

    const nextEntry: Record<string, unknown> = {
      terminalId,
      locationName: this.optionalTrimmed(dto.locationName),
      model: this.optionalTrimmed(dto.model),
      provider: this.optionalTrimmed(dto.provider),
      active: dto.active ?? true,
      cardReaderIds: this.normalizeStringArray(dto.cardReaderIds),
      metadata: dto.metadata || {},
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
    };

    const byTerminalId = new Map<string, Record<string, unknown>>();
    for (const entry of currentTerminals) {
      const id = this.readString(entry.terminalId);
      if (id) byTerminalId.set(id.toUpperCase(), entry);
    }
    byTerminalId.set(terminalId, nextEntry);

    const rules: Record<string, unknown> = {
      ...currentRules,
      terminals: Array.from(byTerminalId.values()),
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
    };

    await this.prisma.featureFlag.update({
      where: { key: flag.key },
      data: {
        isEnabled: true,
        rules: rules as Prisma.InputJsonValue,
      },
    });

    return {
      terminal: nextEntry,
      totalTerminals: byTerminalId.size,
    };
  }

  async createTerminalCheckoutIntent(
    actorId: string,
    dto: TerminalCheckoutIntentDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const terminalId = this.requiredTrimmed(
      dto.terminalId,
      'terminalId',
    ).toUpperCase();

    const intent = await this.commerce.createGuestCheckoutIntent({
      amount: dto.amount,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
      correlationId:
        this.optionalTrimmed(dto.correlationId) ||
        `terminal:${terminalId}:${Date.now()}`,
      sessionId: this.optionalTrimmed(dto.sessionId) || undefined,
      invoiceId: this.optionalTrimmed(dto.invoiceId) || undefined,
      callbackUrl: this.optionalTrimmed(dto.callbackUrl) || undefined,
      ttlMinutes: dto.ttlMinutes,
      metadata: {
        channel: 'TERMINAL',
        flow: 'CARD_READER',
        terminalId,
        cardReaderId: this.optionalTrimmed(dto.cardReaderId),
        initiatedBy: actorId,
        ...(dto.metadata || {}),
      },
    });

    return {
      terminalId,
      paymentIntent: intent.paymentIntent,
      deepLink: intent.deepLink,
      qrPayload: intent.qrPayload,
    };
  }

  async reconcileTerminalCheckoutIntent(
    actorId: string,
    intentId: string,
    dto: TerminalIntentReconcileDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const paymentIntent = await this.commerce.reconcilePaymentIntent(
      this.requiredTrimmed(intentId, 'intentId'),
      {
        status: dto.status,
        providerReference:
          this.optionalTrimmed(dto.providerReference) || undefined,
        note: this.optionalTrimmed(dto.note) || undefined,
        markSettled: dto.markSettled,
      },
    );

    return {
      actorId,
      paymentIntent,
    };
  }

  async applyLoyaltyTransaction(
    actorId: string,
    dto: LoyaltyTransactionDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    if (dto.points === 0) {
      throw new BadRequestException('points must not be zero');
    }

    const driver = await this.prisma.fleetDriver.findUnique({
      where: { id: this.requiredTrimmed(dto.driverId, 'driverId') },
      select: {
        id: true,
        organizationId: true,
        displayName: true,
        metadata: true,
      },
    });

    if (!driver || driver.organizationId !== tenantId) {
      throw new NotFoundException('Fleet driver not found in tenant scope');
    }

    const currentMetadata = this.readRecord(driver.metadata);
    const loyalty = this.extractLoyaltyState(driver.metadata);
    const nextPoints = loyalty.points + dto.points;

    if (nextPoints < 0) {
      throw new BadRequestException('Loyalty balance cannot go below zero');
    }

    const nextTier = this.resolveLoyaltyTier(nextPoints);
    const nextHistory = [
      {
        id: randomUUID(),
        pointsDelta: dto.points,
        reason: this.optionalTrimmed(dto.reason) || 'Manual adjustment',
        occurredAt: new Date().toISOString(),
        actorId,
        correlationId: this.optionalTrimmed(dto.correlationId),
        metadata: dto.metadata || {},
      },
      ...loyalty.history,
    ].slice(0, 50);

    const nextLoyalty = {
      points: nextPoints,
      tier: nextTier,
      updatedAt: new Date().toISOString(),
      history: nextHistory,
    };

    const updated = await this.prisma.fleetDriver.update({
      where: { id: driver.id },
      data: {
        metadata: {
          ...currentMetadata,
          loyalty: nextLoyalty,
        } as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
      select: {
        id: true,
        displayName: true,
        metadata: true,
      },
    });

    return {
      id: updated.id,
      displayName: updated.displayName,
      loyalty: this.extractLoyaltyState(updated.metadata),
    };
  }

  async getDriverWorkflow(
    actorId: string,
    driverId: string,
    query: DriverWorkflowQueryDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const driver = await this.prisma.fleetDriver.findUnique({
      where: { id: this.requiredTrimmed(driverId, 'driverId') },
      include: {
        fleetAccount: {
          select: { id: true, name: true, status: true },
        },
        group: {
          select: { id: true, name: true, status: true },
        },
        tokens: {
          where: { status: 'ACTIVE' },
          orderBy: { assignedAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!driver || driver.organizationId !== tenantId) {
      throw new NotFoundException('Fleet driver not found in tenant scope');
    }

    const includeHistory = query.includeHistory ?? true;

    let vehicles: Awaited<ReturnType<PrismaService['vehicle']['findMany']>> =
      [];
    let bookings: Awaited<ReturnType<PrismaService['booking']['findMany']>> =
      [];
    let sessions: Awaited<ReturnType<PrismaService['session']['findMany']>> =
      [];
    let paymentMethods: Awaited<
      ReturnType<PrismaService['paymentMethod']['findMany']>
    > = [];

    if (driver.userId) {
      [vehicles, bookings, sessions, paymentMethods] = await Promise.all([
        this.prisma.vehicle.findMany({
          where: { userId: driver.userId },
          orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
          take: includeHistory ? 10 : 1,
        }),
        this.prisma.booking.findMany({
          where: {
            userId: driver.userId,
            status: { in: ['PENDING', 'CONFIRMED'] },
          },
          include: { station: { select: { id: true, name: true } } },
          orderBy: [{ startTime: 'asc' }],
          take: includeHistory ? 10 : 1,
        }),
        this.prisma.session.findMany({
          where: { userId: driver.userId },
          include: {
            chargePoint: {
              select: { id: true, stationId: true, ocppId: true, status: true },
            },
          },
          orderBy: [{ startTime: 'desc' }],
          take: includeHistory ? 10 : 3,
        }),
        this.prisma.paymentMethod.findMany({
          where: { userId: driver.userId, status: 'ACTIVE' },
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          take: includeHistory ? 10 : 3,
        }),
      ]);
    }

    const hasIdentity = Boolean(this.optionalTrimmed(driver.userId));
    const hasToken = driver.tokens.length > 0;
    const hasAutocharge = driver.tokens.some(
      (token) => token.tokenType === 'AUTOCHARGE',
    );
    const hasVehicle = vehicles.some((vehicle) => vehicle.isActive);
    const hasPayment = paymentMethods.length > 0;
    const hasReservation = bookings.length > 0;

    return {
      tenantId,
      driver: {
        id: driver.id,
        displayName: driver.displayName,
        status: driver.status,
        userId: driver.userId,
        account: driver.fleetAccount,
        group: driver.group,
      },
      readiness: {
        steps: [
          { id: 'identity', complete: hasIdentity },
          { id: 'token', complete: hasToken },
          { id: 'autocharge', complete: hasAutocharge },
          { id: 'vehicle', complete: hasVehicle },
          { id: 'payment', complete: hasPayment },
          { id: 'reservation', complete: hasReservation },
        ],
      },
      tokens: driver.tokens,
      vehicles,
      bookings: bookings.map((booking) => ({
        ...booking,
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
      })),
      sessions: sessions.map((session) => ({
        ...session,
        startTime: session.startTime.toISOString(),
        endTime: session.endTime ? session.endTime.toISOString() : null,
      })),
      paymentMethods,
    };
  }

  private resolveTenantId(): string {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId || context?.authenticatedOrganizationId;

    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant context is required for vendor baseline operations',
      );
    }

    return tenantId;
  }

  private async assertTenantActor(
    actorId: string,
    tenantId: string,
  ): Promise<void> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const controlPlane = this.prisma.getControlPlaneClient();

    const [user, membership] = await Promise.all([
      controlPlane.user.findUnique({
        where: { id: normalizedActorId },
        select: { role: true },
      }),
      controlPlane.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: normalizedActorId,
            organizationId: tenantId,
          },
        },
        select: { status: true },
      }),
    ]);

    if (!user) {
      throw new ForbiddenException('Authenticated user is not recognized');
    }

    if (PLATFORM_ADMIN_ROLES.has(user.role)) {
      return;
    }

    if (membership?.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(
        'User must be an active tenant member for vendor baseline operations',
      );
    }
  }

  private async assertStationInTenant(
    stationId: string,
    tenantId: string,
  ): Promise<{ id: string; siteId: string | null }> {
    const station = await this.prisma.station.findUnique({
      where: { id: this.requiredTrimmed(stationId, 'stationId') },
      select: {
        id: true,
        siteId: true,
        orgId: true,
        site: { select: { organizationId: true } },
      },
    });

    if (!station) {
      throw new NotFoundException('Station not found');
    }

    const ownerTenant = station.orgId || station.site?.organizationId;
    if (ownerTenant && ownerTenant !== tenantId) {
      throw new ForbiddenException('Station is outside tenant scope');
    }

    return {
      id: station.id,
      siteId: station.siteId,
    };
  }

  private async ensureFeatureFlag(
    key: string,
    description: string,
  ): Promise<{
    id: string;
    key: string;
    rules: Prisma.JsonValue | null;
    isEnabled: boolean;
  }> {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: { id: true, key: true, rules: true, isEnabled: true },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.featureFlag.create({
      data: {
        key,
        description,
        isEnabled: false,
        rules: {},
      },
      select: {
        id: true,
        key: true,
        rules: true,
        isEnabled: true,
      },
    });
  }

  private extractLoyaltyState(value: Prisma.JsonValue | null): LoyaltyState {
    const metadata = this.readRecord(value);
    const loyalty = this.readRecord(metadata.loyalty);

    const points = this.readInteger(loyalty.points) || 0;
    const tier =
      this.readString(loyalty.tier) || this.resolveLoyaltyTier(points);

    return {
      points,
      tier,
      history: Array.isArray(loyalty.history)
        ? loyalty.history
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => this.readRecord(entry))
        : [],
    };
  }

  private resolveLoyaltyTier(points: number): string {
    if (points >= 2500) return 'PLATINUM';
    if (points >= 1000) return 'GOLD';
    if (points >= 250) return 'SILVER';
    return 'BRONZE';
  }

  private normalizeProtocols(values: string[]): SupportedRoamingProtocol[] {
    const normalized = this.normalizeStringArray(values)
      .map((value) => value.toUpperCase())
      .filter((value): value is SupportedRoamingProtocol =>
        (SUPPORTED_ROAMING_PROTOCOLS as readonly string[]).includes(value),
      );

    if (normalized.length === 0) {
      throw new BadRequestException(
        `protocols must include at least one of ${SUPPORTED_ROAMING_PROTOCOLS.join(', ')}`,
      );
    }

    return Array.from(new Set(normalized));
  }

  private readTerminalRegistry(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown>[] {
    const rules = this.readRecord(value);
    if (!Array.isArray(rules.terminals)) {
      return [];
    }

    return rules.terminals
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => this.readRecord(entry));
  }

  private parseIsoDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO date`);
    }
    return parsed;
  }

  private requiredTrimmed(value: string, field: string): string {
    const trimmed = this.optionalTrimmed(value);
    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }
    return trimmed;
  }

  private optionalTrimmed(value?: string | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeStringArray(values?: string[] | null): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return Array.from(
      new Set(
        values
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0),
      ),
    );
  }

  private readRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  private readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on', 'y'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off', 'n'].includes(normalized)) return false;
    }
    return null;
  }

  private readInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.trunc(parsed);
  }
}
