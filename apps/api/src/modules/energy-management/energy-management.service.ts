import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnergyOptimizationPlan,
  EnergyManagementSchedule,
  EnergyMeterPlacement,
  EnergyPlanRun,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { TenantContextService } from '@app/db';
import { CommandsService } from '../commands/commands.service';
import {
  buildEnergyAllocationPlan,
  type EnergyAllocationMethod,
  type EnergyControlMode,
  type EnergyAllocationPlan,
  type PhaseTriple,
} from './energy-management.logic';

type GroupQuery = {
  stationId?: string;
  status?: string;
};

type GroupInput = Record<string, unknown>;
type TelemetryInput = Record<string, unknown>;
type MembershipInput = Record<string, unknown>;
type OverrideInput = Record<string, unknown>;
type RecalculateInput = {
  dryRun?: boolean;
  trigger?: string;
  reason?: string;
};
type ScheduleQuery = {
  stationId?: string;
  groupId?: string;
  status?: string;
};
type PlanRunQuery = {
  stationId?: string;
  groupId?: string;
  planId?: string;
};
type ScheduleInput = Record<string, unknown>;
type PlanRunInput = Record<string, unknown>;

type GroupBundle = Prisma.EnergyLoadGroupGetPayload<{
  include: {
    memberships: true;
    telemetrySnapshots: true;
    allocationDecisions: true;
    alerts: true;
    manualOverrides: true;
  };
}>;

type BundleChargePoint = {
  id: string;
  ocppId: string;
  status: string;
  smartChargingEnabled: boolean;
};

type ResolvedBundle = {
  memberships: GroupBundle['memberships'];
  telemetrySnapshots: GroupBundle['telemetrySnapshots'];
  allocationDecisions: GroupBundle['allocationDecisions'];
  alerts: GroupBundle['alerts'];
  manualOverrides: GroupBundle['manualOverrides'];
  latestTelemetry: GroupBundle['telemetrySnapshots'][number] | null;
  activeOverride: GroupBundle['manualOverrides'][number] | null;
  chargePointMap: Map<string, BundleChargePoint>;
};

const DER_PROFILE_STATUS = new Set(['ACTIVE', 'DISABLED', 'DRAFT']);

@Injectable()
export class EnergyManagementService {
  private readonly logger = new Logger(EnergyManagementService.name);
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly commands: CommandsService,
  ) {}

  async listGroups(query: GroupQuery = {}) {
    const tenantId = this.resolveTenantId();
    const where: Prisma.EnergyLoadGroupWhereInput = { tenantId };
    if (query.stationId?.trim()) where.stationId = query.stationId.trim();
    if (query.status?.trim()) {
      const mode = this.normalizeControlMode(query.status);
      if (mode) where.controlMode = mode;
    }

    const groups = await this.prisma.energyLoadGroup.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
    return Promise.all(groups.map((group) => this.decorateGroup(group.id)));
  }

  async getGroup(id: string) {
    return this.decorateGroup(id, true);
  }

  async getStationDerProfile(stationId: string) {
    const tenantId = this.resolveTenantId();
    const station = await this.assertStationExists(stationId);

    const profile = await this.prisma.energyDerProfile.findUnique({
      where: {
        tenantId_stationId: {
          tenantId,
          stationId: station.id,
        },
      },
    });

    return {
      stationId: station.id,
      siteId: station.siteId,
      organizationId: station.organizationId,
      profile: profile ? this.toDerProfileResponse(profile) : null,
      constraints: this.buildDerConstraintSummary(profile),
      note: profile
        ? 'DER orchestration profile is active for EMS planning.'
        : 'No DER profile configured for this station.',
    };
  }

  async upsertStationDerProfile(
    stationId: string,
    input: Record<string, unknown>,
    actorId?: string,
  ) {
    const tenantId = this.resolveTenantId();
    const station = await this.assertStationExists(stationId);
    const current = await this.prisma.energyDerProfile.findUnique({
      where: {
        tenantId_stationId: {
          tenantId,
          stationId: station.id,
        },
      },
    });

    const statusInput = this.normalizeDerStatus(input.status);
    const maxGridImportKwInput = this.readOptionalNonNegativeFloatInput(
      input.maxGridImportKw,
      'maxGridImportKw',
    );
    const reserveGridKwInput = this.readOptionalNonNegativeFloatInput(
      input.reserveGridKw,
      'reserveGridKw',
    );
    const solarEnabledInput = this.readOptionalBooleanInput(
      input.solarEnabled,
      'solarEnabled',
    );
    const maxSolarContributionKwInput = this.readOptionalNonNegativeFloatInput(
      input.maxSolarContributionKw,
      'maxSolarContributionKw',
    );
    const bessEnabledInput = this.readOptionalBooleanInput(
      input.bessEnabled,
      'bessEnabled',
    );
    const maxBessDischargeKwInput = this.readOptionalNonNegativeFloatInput(
      input.maxBessDischargeKw,
      'maxBessDischargeKw',
    );
    const bessSocPercentInput = this.readOptionalPercentInput(
      input.bessSocPercent,
      'bessSocPercent',
    );
    const bessReserveSocPercentInput = this.readOptionalPercentInput(
      input.bessReserveSocPercent,
      'bessReserveSocPercent',
    );
    const forecastInput = this.normalizeOptionalJsonInput(
      input.forecast,
      'forecast',
    );
    const metadataInput = this.normalizeOptionalJsonInput(
      input.metadata,
      'metadata',
    );

    const status = statusInput ?? current?.status ?? 'ACTIVE';
    const maxGridImportKw =
      maxGridImportKwInput !== undefined
        ? maxGridImportKwInput
        : (current?.maxGridImportKw ?? null);
    const reserveGridKw =
      reserveGridKwInput !== undefined
        ? reserveGridKwInput
        : (current?.reserveGridKw ?? null);
    if (
      maxGridImportKw !== null &&
      reserveGridKw !== null &&
      reserveGridKw > maxGridImportKw
    ) {
      throw new BadRequestException(
        'reserveGridKw cannot exceed maxGridImportKw',
      );
    }

    const solarEnabled = solarEnabledInput ?? current?.solarEnabled ?? false;
    let maxSolarContributionKw =
      maxSolarContributionKwInput !== undefined
        ? maxSolarContributionKwInput
        : (current?.maxSolarContributionKw ?? null);
    if (!solarEnabled) {
      maxSolarContributionKw = null;
    }

    const bessEnabled = bessEnabledInput ?? current?.bessEnabled ?? false;
    let maxBessDischargeKw =
      maxBessDischargeKwInput !== undefined
        ? maxBessDischargeKwInput
        : (current?.maxBessDischargeKw ?? null);
    if (!bessEnabled) {
      maxBessDischargeKw = null;
    }

    const bessSocPercent =
      bessSocPercentInput !== undefined
        ? bessSocPercentInput
        : (current?.bessSocPercent ?? null);
    const bessReserveSocPercent =
      bessReserveSocPercentInput !== undefined
        ? bessReserveSocPercentInput
        : (current?.bessReserveSocPercent ?? null);

    const forecast =
      forecastInput !== undefined ? forecastInput : (current?.forecast ?? null);
    const metadata =
      metadataInput !== undefined ? metadataInput : (current?.metadata ?? null);
    const forecastValue = forecast === null ? Prisma.JsonNull : forecast;
    const metadataValue = metadata === null ? Prisma.JsonNull : metadata;

    const profile = await this.prisma.energyDerProfile.upsert({
      where: {
        tenantId_stationId: {
          tenantId,
          stationId: station.id,
        },
      },
      create: {
        tenantId,
        organizationId: station.organizationId,
        stationId: station.id,
        siteId: station.siteId,
        status,
        maxGridImportKw,
        reserveGridKw,
        solarEnabled,
        maxSolarContributionKw,
        bessEnabled,
        maxBessDischargeKw,
        bessSocPercent,
        bessReserveSocPercent,
        forecast: forecastValue,
        metadata: metadataValue,
        createdBy: actorId || null,
        updatedBy: actorId || null,
      },
      update: {
        status,
        maxGridImportKw,
        reserveGridKw,
        solarEnabled,
        maxSolarContributionKw,
        bessEnabled,
        maxBessDischargeKw,
        bessSocPercent,
        bessReserveSocPercent,
        forecast: forecastValue,
        metadata: metadataValue,
        updatedBy: actorId || current?.updatedBy || null,
      },
    });
    await this.recordAuditEvent({
      actorId: actorId || 'system:energy-management',
      action: 'ENERGY_DER_PROFILE_UPSERTED',
      resource: 'EnergyDerProfile',
      resourceId: profile.id,
      details: {
        tenantId,
        stationId: station.id,
        status: profile.status,
        maxGridImportKw: profile.maxGridImportKw,
        reserveGridKw: profile.reserveGridKw,
        solarEnabled: profile.solarEnabled,
        bessEnabled: profile.bessEnabled,
      },
    });

    return {
      stationId: station.id,
      siteId: station.siteId,
      organizationId: station.organizationId,
      profile: this.toDerProfileResponse(profile),
      constraints: this.buildDerConstraintSummary(profile),
      note: 'DER orchestration profile updated successfully.',
    };
  }

  async createGroup(input: GroupInput) {
    const tenantId = this.resolveTenantId();
    const stationId = this.readString(input.stationId);
    const name = this.readString(input.name);
    if (!stationId) throw new BadRequestException('stationId is required');
    if (!name) throw new BadRequestException('name is required');

    await this.assertStationExists(stationId);

    const created = await this.prisma.energyLoadGroup.create({
      data: {
        tenantId,
        stationId,
        name,
        description: this.readOptionalString(input.description),
        controlMode:
          this.normalizeControlMode(input.controlMode) || 'OBSERVE_ONLY',
        allocationMethod:
          this.normalizeAllocationMethod(input.allocationMethod) || 'EQUAL',
        meterSource: this.readOptionalString(input.meterSource),
        meterPlacement:
          this.normalizeMeterPlacement(input.meterPlacement) || 'MAIN',
        siteLimitAmpsPhase1:
          this.readNonNegativeInt(input.siteLimitAmpsPhase1) ?? 0,
        siteLimitAmpsPhase2:
          this.readNonNegativeInt(input.siteLimitAmpsPhase2) ?? 0,
        siteLimitAmpsPhase3:
          this.readNonNegativeInt(input.siteLimitAmpsPhase3) ?? 0,
        dynamicBufferAmpsPhase1:
          this.readNonNegativeInt(input.dynamicBufferAmpsPhase1) ?? 0,
        dynamicBufferAmpsPhase2:
          this.readNonNegativeInt(input.dynamicBufferAmpsPhase2) ?? 0,
        dynamicBufferAmpsPhase3:
          this.readNonNegativeInt(input.dynamicBufferAmpsPhase3) ?? 0,
        failSafeAmpsPhase1:
          this.readNonNegativeInt(input.failSafeAmpsPhase1) ?? 0,
        failSafeAmpsPhase2:
          this.readNonNegativeInt(input.failSafeAmpsPhase2) ?? 0,
        failSafeAmpsPhase3:
          this.readNonNegativeInt(input.failSafeAmpsPhase3) ?? 0,
        deadbandAmps: this.readPositiveInt(input.deadbandAmps) || 1,
        staleWarningAfterSec:
          this.readPositiveInt(input.staleWarningAfterSec) || 30,
        failSafeAfterSec: this.readPositiveInt(input.failSafeAfterSec) || 60,
        commandRefreshSec: this.readPositiveInt(input.commandRefreshSec) || 300,
        observeOnly: this.readBoolean(input.observeOnly) ?? true,
        isActive: this.readBoolean(input.isActive) || false,
      },
    });

    const memberships = this.normalizeMembershipInputs(
      Array.isArray(input.memberships)
        ? (input.memberships as MembershipInput[])
        : [],
    );
    if (memberships.length > 0) {
      await this.replaceMemberships(created.id, memberships);
    }

    if (this.readBoolean(input.activateNow)) {
      await this.activateGroup(created.id, {
        reason:
          this.readOptionalString(input.activationReason) ||
          'Manual activation',
      });
    }

    return this.getGroup(created.id);
  }

  async updateGroup(id: string, input: GroupInput) {
    const group = await this.loadGroupOrThrow(id);
    const data: Prisma.EnergyLoadGroupUpdateInput = {};

    if (input.name !== undefined) {
      const name = this.readString(input.name);
      if (!name) throw new BadRequestException('name cannot be empty');
      data.name = name;
    }
    if (input.description !== undefined) {
      data.description = this.readOptionalString(input.description);
    }
    if (input.meterSource !== undefined) {
      data.meterSource = this.readOptionalString(input.meterSource);
    }
    if (input.meterPlacement !== undefined) {
      const meterPlacement = this.normalizeMeterPlacement(input.meterPlacement);
      if (!meterPlacement)
        throw new BadRequestException('Invalid meterPlacement');
      data.meterPlacement = meterPlacement;
    }
    if (input.allocationMethod !== undefined) {
      const allocationMethod = this.normalizeAllocationMethod(
        input.allocationMethod,
      );
      if (!allocationMethod)
        throw new BadRequestException('Invalid allocationMethod');
      data.allocationMethod = allocationMethod;
    }

    for (const field of [
      'siteLimitAmpsPhase1',
      'siteLimitAmpsPhase2',
      'siteLimitAmpsPhase3',
      'dynamicBufferAmpsPhase1',
      'dynamicBufferAmpsPhase2',
      'dynamicBufferAmpsPhase3',
      'failSafeAmpsPhase1',
      'failSafeAmpsPhase2',
      'failSafeAmpsPhase3',
      'deadbandAmps',
      'staleWarningAfterSec',
      'failSafeAfterSec',
      'commandRefreshSec',
    ] as const) {
      if (input[field] !== undefined) {
        const requiresPositive =
          field === 'deadbandAmps' ||
          field === 'staleWarningAfterSec' ||
          field === 'failSafeAfterSec' ||
          field === 'commandRefreshSec';
        const value = requiresPositive
          ? this.readPositiveInt(input[field])
          : this.readNonNegativeInt(input[field]);
        if (value === null) {
          throw new BadRequestException(
            `${field} must be a ${requiresPositive ? 'positive' : 'non-negative'} integer`,
          );
        }
        data[field] = value;
      }
    }

    if (input.observeOnly !== undefined) {
      data.observeOnly = this.readBoolean(input.observeOnly) ?? false;
    }

    await this.prisma.energyLoadGroup.update({
      where: { id: group.id },
      data,
    });

    if (input.memberships !== undefined) {
      await this.replaceMemberships(
        group.id,
        this.normalizeMembershipInputs(input.memberships as MembershipInput[]),
      );
    }

    if (this.readBoolean(input.recalculateNow)) {
      await this.recalculateGroup(group.id, {
        trigger: 'config-update',
        reason: 'Group configuration updated',
      });
    }

    return this.getGroup(group.id);
  }

  async deleteGroup(id: string) {
    const group = await this.loadGroupOrThrow(id);
    await this.prisma.energyLoadGroup.update({
      where: { id: group.id },
      data: { controlMode: 'DISABLED', observeOnly: true, isActive: false },
    });
    return this.getGroup(group.id);
  }

  async activateGroup(id: string, input: { reason?: string } = {}) {
    const group = await this.loadGroupOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.energyLoadGroup.updateMany({
        where: {
          tenantId: group.tenantId,
          stationId: group.stationId,
          id: { not: group.id },
          isActive: true,
        },
        data: {
          isActive: false,
          controlMode: 'OBSERVE_ONLY',
          observeOnly: true,
        },
      });
      await tx.energyLoadGroup.update({
        where: { id: group.id },
        data: { controlMode: 'ACTIVE', observeOnly: false, isActive: true },
      });
    });
    await this.recalculateGroup(group.id, {
      trigger: 'activation',
      reason: input.reason || 'Group activated',
    });
    return this.getGroup(group.id);
  }

  async disableGroup(id: string, input: { reason?: string } = {}) {
    const group = await this.loadGroupOrThrow(id);
    await this.prisma.energyLoadGroup.update({
      where: { id: group.id },
      data: { controlMode: 'DISABLED', observeOnly: true, isActive: false },
    });
    await this.recalculateGroup(group.id, {
      trigger: 'disable',
      reason: input.reason || 'Group disabled',
    });
    return this.getGroup(group.id);
  }

  async replaceMemberships(id: string, memberships: MembershipInput[]) {
    const group = await this.loadGroupOrThrow(id);
    const normalized = this.normalizeMembershipInputs(memberships);
    if (normalized.length === 0) {
      await this.prisma.energyLoadGroupMembership.deleteMany({
        where: { groupId: group.id },
      });
      return this.getGroup(group.id);
    }

    const chargePoints = await this.prisma.chargePoint.findMany({
      where: {
        id: { in: normalized.map((membership) => membership.chargePointId) },
      },
      select: {
        id: true,
        ocppId: true,
        stationId: true,
        status: true,
        smartChargingEnabled: true,
      },
    });
    const chargePointMap = new Map(chargePoints.map((cp) => [cp.id, cp]));

    for (const membership of normalized) {
      const cp = chargePointMap.get(membership.chargePointId);
      if (!cp) {
        throw new BadRequestException(
          `Charge point ${membership.chargePointId} not found`,
        );
      }
      if (cp.stationId !== group.stationId) {
        throw new BadRequestException(
          `Charge point ${cp.ocppId} does not belong to station ${group.stationId}`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.energyLoadGroupMembership.deleteMany({
        where: { groupId: group.id },
      });
      await tx.energyLoadGroupMembership.createMany({
        data: normalized.map((membership) => ({
          groupId: group.id,
          chargePointId: membership.chargePointId,
          priority: membership.priority,
          enabled: membership.enabled,
          smartChargingEnabled: this.resolveChargePointCapability(
            chargePointMap.get(membership.chargePointId),
            false,
          ),
          maxAmps: membership.maxAmps,
        })),
      });
    });

    await this.recalculateGroup(group.id, {
      trigger: 'membership-update',
      reason: 'Memberships updated',
    });
    return this.getGroup(group.id);
  }

  async ingestTelemetry(id: string, input: TelemetryInput) {
    const group = await this.loadGroupOrThrow(id);
    const sampledAt = this.parseDate(input.sampledAt) || new Date();
    const siteLoad = this.toPhaseTripleFromRecord(input, 'siteLoad');
    const nonEvLoad = this.toPhaseTripleFromRecord(input, 'nonEvLoad');
    const buffer = this.toPhaseTriple(group, 'dynamicBuffer');
    const siteLimitPhase1 =
      this.readNonNegativeInt(group.siteLimitAmpsPhase1) ?? 0;
    const siteLimitPhase2 =
      this.readNonNegativeInt(group.siteLimitAmpsPhase2) ?? 0;
    const siteLimitPhase3 =
      this.readNonNegativeInt(group.siteLimitAmpsPhase3) ?? 0;
    const headroom = {
      phase1: Math.max(0, siteLimitPhase1 - nonEvLoad.phase1 - buffer.phase1),
      phase2: Math.max(0, siteLimitPhase2 - nonEvLoad.phase2 - buffer.phase2),
      phase3: Math.max(0, siteLimitPhase3 - nonEvLoad.phase3 - buffer.phase3),
    };
    const freshnessSec = this.readNonNegativeInt(input.freshnessSec) ?? 0;

    await this.prisma.energyTelemetrySnapshot.create({
      data: {
        groupId: group.id,
        stationId: group.stationId,
        sampledAt,
        meterSource:
          this.readOptionalString(input.meterSource) || group.meterSource,
        meterPlacement: group.meterPlacement,
        siteLoadAmpsPhase1: siteLoad.phase1,
        siteLoadAmpsPhase2: siteLoad.phase2,
        siteLoadAmpsPhase3: siteLoad.phase3,
        nonEvLoadAmpsPhase1: nonEvLoad.phase1,
        nonEvLoadAmpsPhase2: nonEvLoad.phase2,
        nonEvLoadAmpsPhase3: nonEvLoad.phase3,
        availableAmpsPhase1: headroom.phase1,
        availableAmpsPhase2: headroom.phase2,
        availableAmpsPhase3: headroom.phase3,
        headroomAmpsPhase1: headroom.phase1,
        headroomAmpsPhase2: headroom.phase2,
        headroomAmpsPhase3: headroom.phase3,
        freshnessSec,
        rawTelemetry:
          input.rawTelemetry !== undefined
            ? (input.rawTelemetry as Prisma.InputJsonValue)
            : undefined,
        reasonCode: 'TELEMETRY_INGEST',
      },
    });

    await this.prisma.energyLoadGroup.update({
      where: { id: group.id },
      data: {
        latestTelemetryAt: sampledAt,
        lastMeterFreshnessSec: freshnessSec,
        lastSiteLoadAmpsPhase1: siteLoad.phase1,
        lastSiteLoadAmpsPhase2: siteLoad.phase2,
        lastSiteLoadAmpsPhase3: siteLoad.phase3,
        lastNonEvLoadAmpsPhase1: nonEvLoad.phase1,
        lastNonEvLoadAmpsPhase2: nonEvLoad.phase2,
        lastNonEvLoadAmpsPhase3: nonEvLoad.phase3,
        lastHeadroomAmpsPhase1: headroom.phase1,
        lastHeadroomAmpsPhase2: headroom.phase2,
        lastHeadroomAmpsPhase3: headroom.phase3,
      },
    });

    return this.recalculateGroup(group.id, {
      trigger: 'telemetry',
      reason: 'Telemetry ingested',
    });
  }

  async recalculateGroup(id: string, input: RecalculateInput = {}) {
    return this.withLock(id, async () => {
      const group = await this.loadGroupOrThrow(id);
      const bundle = await this.loadBundle(group);
      const plan = buildEnergyAllocationPlan({
        groupId: group.id,
        controlMode: group.controlMode as EnergyControlMode,
        observeOnly: group.observeOnly,
        allocationMethod: group.allocationMethod as EnergyAllocationMethod,
        siteLimitAmps: this.toPhaseTriple(group, 'siteLimit'),
        nonEvLoadAmps: this.toPhaseTriple(group, 'nonEvLoad'),
        dynamicBufferAmps: this.toPhaseTriple(group, 'dynamicBuffer'),
        failSafeAmps: this.toPhaseTriple(group, 'failSafe'),
        deadbandAmps: group.deadbandAmps,
        staleWarningAfterSec: group.staleWarningAfterSec,
        failSafeAfterSec: group.failSafeAfterSec,
        commandRefreshSec: group.commandRefreshSec,
        nowIso: new Date().toISOString(),
        telemetry: bundle.latestTelemetry
          ? {
              sampledAt: bundle.latestTelemetry.sampledAt.toISOString(),
              freshnessSec: bundle.latestTelemetry.freshnessSec,
              meterSource: bundle.latestTelemetry.meterSource,
            }
          : null,
        override: bundle.activeOverride
          ? {
              active: true,
              capAmps: bundle.activeOverride.capAmps,
              expiresAt: bundle.activeOverride.expiresAt.toISOString(),
            }
          : null,
        memberships: bundle.memberships.map((membership) => ({
          chargePointId: membership.chargePointId,
          enabled: membership.enabled,
          priority: membership.priority,
          smartChargingEnabled: this.resolveChargePointCapability(
            bundle.chargePointMap.get(membership.chargePointId),
            membership.smartChargingEnabled,
          ),
          chargePointOnline: this.resolveChargePointAvailability(
            bundle.chargePointMap.get(membership.chargePointId),
          ),
          maxAmps: membership.maxAmps,
          lastAppliedAmps: membership.lastAppliedAmps,
          lastAppliedDecisionHash: membership.lastAppliedDecisionHash,
          lastCommandAt: membership.lastCommandAt?.toISOString() || null,
        })),
      });

      const commands = await this.applyPlan(group, bundle, plan, input);
      const decision = await this.prisma.energyAllocationDecision.create({
        data: {
          groupId: group.id,
          decisionHash: plan.decisionHash,
          triggeredBy: input.trigger || 'manual',
          reasonCode: input.reason || plan.reasonCode,
          state: input.dryRun ? 'DRY_RUN' : plan.state,
          inputSnapshot: {
            group: this.toDecisionGroupSnapshot(group),
            telemetry: bundle.latestTelemetry
              ? this.toDecisionTelemetrySnapshot(bundle.latestTelemetry)
              : null,
            override: bundle.activeOverride
              ? this.toDecisionOverrideSnapshot(bundle.activeOverride)
              : null,
            memberships: bundle.memberships.map((membership) =>
              this.toDecisionMembershipSnapshot(
                membership,
                bundle.chargePointMap.get(membership.chargePointId),
              ),
            ),
          } as unknown as Prisma.InputJsonValue,
          outputSnapshot: {
            plan,
            commands,
          } as unknown as Prisma.InputJsonValue,
          commandCount: commands.length,
          appliedAt: commands.length > 0 ? new Date() : null,
          relatedOverrideId: bundle.activeOverride?.id || null,
        },
      });

      await this.prisma.energyLoadGroup.update({
        where: { id: group.id },
        data: {
          latestDecisionAt: new Date(),
          latestDecisionHash: plan.decisionHash,
          latestAppliedAt:
            commands.length > 0 ? new Date() : group.latestAppliedAt,
          latestReasonCode: input.reason || plan.reasonCode,
        },
      });

      return this.decorateGroup(group.id, true, decision.id, plan, commands);
    });
  }

  async recalculateStation(stationId: string, reason: string) {
    const tenantId = this.resolveTenantIdOrNull();
    const groups = await this.prisma.energyLoadGroup.findMany({
      where: {
        stationId,
        isActive: true,
        ...(tenantId ? { tenantId } : {}),
      },
      select: { id: true },
    });

    return Promise.all(
      groups.map((group) =>
        this.recalculateGroup(group.id, { trigger: 'station-event', reason }),
      ),
    );
  }

  async createOverride(id: string, input: OverrideInput, actorId?: string) {
    const group = await this.loadGroupOrThrow(id);
    const reason = this.readString(input.reason);
    const expiresAt = this.parseDate(input.expiresAt);
    const capAmps = this.readNonNegativeInt(input.capAmps);
    if (!reason) throw new BadRequestException('reason is required');
    if (!expiresAt) throw new BadRequestException('expiresAt must be valid');
    if (capAmps === null) throw new BadRequestException('capAmps is required');

    const created = await this.prisma.energyManualOverride.create({
      data: {
        groupId: group.id,
        reason,
        requestedBy: actorId || null,
        capAmps,
        expiresAt,
        status: 'ACTIVE',
      },
    });
    await this.recordAuditEvent({
      actorId: actorId || 'system:energy-management',
      action: 'ENERGY_MANUAL_OVERRIDE_CREATED',
      resource: 'EnergyManualOverride',
      resourceId: created.id,
      details: {
        tenantId: group.tenantId,
        groupId: group.id,
        stationId: group.stationId,
        capAmps,
        expiresAt: expiresAt.toISOString(),
        reason,
      },
    });

    return this.recalculateGroup(group.id, {
      trigger: 'override',
      reason: 'Manual override applied',
    });
  }

  async clearOverride(id: string, overrideId: string, actorId?: string) {
    const group = await this.loadGroupOrThrow(id);
    const override = await this.prisma.energyManualOverride.findFirst({
      where: { id: overrideId, groupId: group.id },
    });
    if (!override) throw new NotFoundException('Manual override not found');

    await this.prisma.energyManualOverride.update({
      where: { id: override.id },
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
        requestedBy: actorId || override.requestedBy,
      },
    });
    await this.recordAuditEvent({
      actorId: actorId || 'system:energy-management',
      action: 'ENERGY_MANUAL_OVERRIDE_CLEARED',
      resource: 'EnergyManualOverride',
      resourceId: override.id,
      details: {
        tenantId: group.tenantId,
        groupId: group.id,
        stationId: group.stationId,
      },
    });

    return this.recalculateGroup(group.id, {
      trigger: 'override-clear',
      reason: 'Manual override cleared',
    });
  }

  async acknowledgeAlert(id: string, alertId: string, actorId?: string) {
    const group = await this.loadGroupOrThrow(id);
    const alert = await this.prisma.energyAlert.findFirst({
      where: { id: alertId, groupId: group.id },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    await this.prisma.energyAlert.update({
      where: { id: alert.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedBy: actorId || null,
      },
    });

    return this.getGroup(group.id);
  }

  async simulateMeterLoss(id: string, actorId?: string) {
    const group = await this.loadGroupOrThrow(id);
    await this.prisma.energyTelemetrySnapshot.create({
      data: {
        groupId: group.id,
        stationId: group.stationId,
        sampledAt: new Date(Date.now() - (group.failSafeAfterSec + 30) * 1000),
        meterSource: group.meterSource,
        meterPlacement: group.meterPlacement,
        siteLoadAmpsPhase1: group.lastSiteLoadAmpsPhase1 || 0,
        siteLoadAmpsPhase2: group.lastSiteLoadAmpsPhase2 || 0,
        siteLoadAmpsPhase3: group.lastSiteLoadAmpsPhase3 || 0,
        nonEvLoadAmpsPhase1: group.lastNonEvLoadAmpsPhase1 || 0,
        nonEvLoadAmpsPhase2: group.lastNonEvLoadAmpsPhase2 || 0,
        nonEvLoadAmpsPhase3: group.lastNonEvLoadAmpsPhase3 || 0,
        availableAmpsPhase1: 0,
        availableAmpsPhase2: 0,
        availableAmpsPhase3: 0,
        headroomAmpsPhase1: 0,
        headroomAmpsPhase2: 0,
        headroomAmpsPhase3: 0,
        freshnessSec: group.failSafeAfterSec + 30,
        rawTelemetry: {
          injectedBy: actorId || 'system',
          mode: 'meter-loss',
        } as Prisma.InputJsonValue,
        reasonCode: 'METER_LOSS_SIMULATION',
      },
    });

    await this.prisma.energyAlert.create({
      data: {
        groupId: group.id,
        code: 'METER_FAILSAFE',
        severity: 'WARNING',
        title: 'Meter telemetry lost',
        message:
          'No fresh meter telemetry is available. The allocator will fall back to the fail-safe limit.',
        metadata: {
          simulated: true,
          injectedBy: actorId || 'system',
        } as Prisma.InputJsonValue,
      },
    });

    return this.recalculateGroup(group.id, {
      trigger: 'meter-loss',
      reason: 'Meter loss simulated',
    });
  }

  async listSchedules(query: ScheduleQuery = {}) {
    const tenantId = this.resolveTenantId();
    const where: Prisma.EnergyManagementScheduleWhereInput = { tenantId };
    if (query.stationId?.trim()) where.stationId = query.stationId.trim();
    if (query.groupId?.trim()) where.groupId = query.groupId.trim();
    const normalizedStatus = this.normalizeScheduleStatus(query.status);
    if (normalizedStatus) where.status = normalizedStatus;

    const rows = await this.prisma.energyManagementSchedule.findMany({
      where,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toScheduleResponse(row));
  }

  async createSchedule(input: ScheduleInput, actorId?: string) {
    const tenantId = this.resolveTenantId();
    const planId = this.readOptionalString(input.planId);
    const notes = this.readOptionalString(input.notes);
    let plan: EnergyOptimizationPlan | null = null;
    let stationId = this.readOptionalString(input.stationId);
    let groupId = this.readOptionalString(input.groupId);
    let startsAt = this.parseDate(input.startsAt);
    let endsAt = this.parseDate(input.endsAt);
    let entries = Array.isArray(input.entries) ? input.entries : [];
    let fallbackToDlm = this.readBoolean(input.fallbackToDlm) ?? false;

    if (planId) {
      plan = await this.prisma.energyOptimizationPlan.findUnique({
        where: { id: planId },
      });
      if (!plan || plan.tenantId !== tenantId) {
        throw new NotFoundException('Optimization plan not found');
      }
      stationId = plan.stationId;
      groupId = plan.groupId || groupId;
      startsAt = plan.windowStart;
      endsAt = plan.windowEnd;
      entries = Array.isArray(plan.schedule) ? plan.schedule : entries;
      fallbackToDlm = fallbackToDlm || plan.state === 'FALLBACK_DLM';
    }

    if (!stationId) {
      throw new BadRequestException('stationId is required');
    }
    await this.assertStationExists(stationId);

    if (groupId) {
      const group = await this.prisma.energyLoadGroup.findUnique({
        where: { id: groupId },
        select: { id: true, tenantId: true, stationId: true },
      });
      if (!group || group.tenantId !== tenantId) {
        throw new NotFoundException('Energy load group not found');
      }
      if (group.stationId !== stationId) {
        throw new BadRequestException(
          'groupId does not belong to the provided station',
        );
      }
    }

    const windowStart = startsAt || new Date();
    const windowEnd =
      endsAt || new Date(windowStart.getTime() + 4 * 3600 * 1000);
    if (windowEnd.getTime() <= windowStart.getTime()) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
    if (!Array.isArray(entries)) {
      throw new BadRequestException('entries must be an array');
    }

    const requestedStatus = this.normalizeScheduleStatus(input.status);
    const status = fallbackToDlm
      ? 'FALLBACK_DLM'
      : requestedStatus || 'PENDING_APPROVAL';

    const created = await this.prisma.energyManagementSchedule.create({
      data: {
        tenantId,
        stationId,
        groupId: groupId || null,
        planId: plan?.id || planId || null,
        status,
        startsAt: windowStart,
        endsAt: windowEnd,
        entries: entries as unknown as Prisma.InputJsonValue,
        fallbackToDlm,
        notes: notes || null,
        createdBy: actorId || null,
      },
    });

    await this.prisma.energyPlanRun.create({
      data: {
        tenantId,
        planId: created.planId || null,
        scheduleId: created.id,
        stationId: created.stationId,
        groupId: created.groupId,
        trigger: 'schedule-create',
        state: fallbackToDlm ? 'FALLBACK_DLM' : 'PREVIEW',
        message: fallbackToDlm
          ? 'Tariff plan fallback applied; EMS remains in DLM control.'
          : 'Schedule created and awaiting approval.',
        startedAt: new Date(),
        completedAt: new Date(),
        metrics: {
          entryCount: entries.length,
          fallbackToDlm,
        } as Prisma.InputJsonValue,
        output: {
          scheduleId: created.id,
          status: created.status,
        } as Prisma.InputJsonValue,
        initiatedBy: actorId || null,
      },
    });

    if (created.planId) {
      await this.prisma.energyOptimizationPlan.updateMany({
        where: {
          id: created.planId,
          tenantId,
          state: { in: ['DRAFT', 'READY_FOR_APPROVAL'] },
        },
        data: {
          state: fallbackToDlm ? 'FALLBACK_DLM' : 'SCHEDULED',
        },
      });
    }

    return this.toScheduleResponse(created);
  }

  async approveSchedule(
    id: string,
    input: ScheduleInput = {},
    actorId?: string,
  ) {
    const tenantId = this.resolveTenantId();
    const schedule = await this.prisma.energyManagementSchedule.findUnique({
      where: { id },
    });
    if (!schedule || schedule.tenantId !== tenantId) {
      throw new NotFoundException('Schedule not found');
    }

    const notes = this.readOptionalString(input.notes);
    const forceFallback = this.readBoolean(input.fallbackToDlm) ?? false;
    const nextStatus =
      schedule.fallbackToDlm ||
      forceFallback ||
      schedule.status === 'FALLBACK_DLM'
        ? 'FALLBACK_DLM'
        : 'ACTIVE';

    const approved = await this.prisma.$transaction(async (tx) => {
      if (nextStatus === 'ACTIVE') {
        if (schedule.groupId) {
          await tx.energyManagementSchedule.updateMany({
            where: {
              tenantId,
              groupId: schedule.groupId,
              id: { not: schedule.id },
              status: 'ACTIVE',
            },
            data: { status: 'SUPERSEDED' },
          });
        } else {
          await tx.energyManagementSchedule.updateMany({
            where: {
              tenantId,
              stationId: schedule.stationId,
              id: { not: schedule.id },
              status: 'ACTIVE',
            },
            data: { status: 'SUPERSEDED' },
          });
        }
      }

      const updated = await tx.energyManagementSchedule.update({
        where: { id: schedule.id },
        data: {
          status: nextStatus,
          fallbackToDlm: nextStatus === 'FALLBACK_DLM',
          approvedBy: actorId || schedule.approvedBy,
          approvedAt: new Date(),
          notes: notes || schedule.notes,
        },
      });

      await tx.energyPlanRun.create({
        data: {
          tenantId,
          planId: updated.planId,
          scheduleId: updated.id,
          stationId: updated.stationId,
          groupId: updated.groupId,
          trigger: 'schedule-approve',
          state: nextStatus === 'ACTIVE' ? 'APPLIED' : 'FALLBACK_DLM',
          message:
            nextStatus === 'ACTIVE'
              ? 'Schedule approved and marked active.'
              : 'Schedule approved in fallback mode; EMS remains in DLM control.',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: actorId || null,
          metrics: {
            fallbackToDlm: nextStatus !== 'ACTIVE',
          } as Prisma.InputJsonValue,
          output: {
            scheduleId: updated.id,
            status: updated.status,
          } as Prisma.InputJsonValue,
        },
      });

      if (updated.planId) {
        await tx.energyOptimizationPlan.updateMany({
          where: { id: updated.planId, tenantId },
          data: {
            state: nextStatus === 'ACTIVE' ? 'APPROVED' : 'FALLBACK_DLM',
            approvedBy: actorId || undefined,
            approvedAt: new Date(),
          },
        });
      }

      return updated;
    });

    return this.toScheduleResponse(approved);
  }

  async listPlanRuns(query: PlanRunQuery = {}) {
    const tenantId = this.resolveTenantId();
    const where: Prisma.EnergyPlanRunWhereInput = { tenantId };
    if (query.stationId?.trim()) where.stationId = query.stationId.trim();
    if (query.groupId?.trim()) where.groupId = query.groupId.trim();
    if (query.planId?.trim()) where.planId = query.planId.trim();

    const rows = await this.prisma.energyPlanRun.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }],
      take: 200,
    });
    return rows.map((row) => this.toPlanRunResponse(row));
  }

  async createPlanRun(input: PlanRunInput, actorId?: string) {
    const tenantId = this.resolveTenantId();
    let planId = this.readOptionalString(input.planId);
    const scheduleId = this.readOptionalString(input.scheduleId);
    let stationId = this.readOptionalString(input.stationId);
    let groupId = this.readOptionalString(input.groupId);

    if (planId) {
      const plan = await this.prisma.energyOptimizationPlan.findUnique({
        where: { id: planId },
      });
      if (!plan || plan.tenantId !== tenantId) {
        throw new NotFoundException('Optimization plan not found');
      }
      stationId = stationId || plan.stationId;
      groupId = groupId || plan.groupId || undefined;
    }

    if (scheduleId) {
      const schedule = await this.prisma.energyManagementSchedule.findUnique({
        where: { id: scheduleId },
      });
      if (!schedule || schedule.tenantId !== tenantId) {
        throw new NotFoundException('Schedule not found');
      }
      planId = planId || schedule.planId || undefined;
      stationId = stationId || schedule.stationId;
      groupId = groupId || schedule.groupId || undefined;
    }

    if (!stationId && !groupId && !planId && !scheduleId) {
      throw new BadRequestException(
        'At least one of stationId, groupId, planId, or scheduleId is required',
      );
    }

    const trigger = this.readString(input.trigger) || 'manual';
    const dryRun = this.readBoolean(input.dryRun) ?? true;
    const requestedState = this.normalizePlanRunState(input.state);
    const state = requestedState || (dryRun ? 'DRY_RUN' : 'QUEUED');
    const now = new Date();

    const created = await this.prisma.energyPlanRun.create({
      data: {
        tenantId,
        planId: planId || null,
        scheduleId: scheduleId || null,
        stationId: stationId || null,
        groupId: groupId || null,
        trigger,
        state,
        message: this.readOptionalString(input.message) || null,
        startedAt: now,
        completedAt: dryRun ? now : null,
        metrics: this.readRecord(input.metrics)
          ? (this.readRecord(input.metrics) as Prisma.InputJsonValue)
          : undefined,
        output: this.readRecord(input.output)
          ? (this.readRecord(input.output) as Prisma.InputJsonValue)
          : undefined,
        initiatedBy: actorId || null,
      },
    });

    return this.toPlanRunResponse(created);
  }

  async getHistory(id: string, limit = 25) {
    const group = await this.loadGroupOrThrow(id);
    const rows = await this.prisma.energyAllocationDecision.findMany({
      where: { groupId: group.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Math.floor(limit || 25), 1), 100),
    });

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
      decisionHash: row.decisionHash,
      reasonCode: row.reasonCode,
      state: row.state,
      commandCount: row.commandCount,
      triggeredBy: row.triggeredBy,
      inputSnapshot: row.inputSnapshot,
      outputSnapshot: row.outputSnapshot,
    }));
  }

  private toScheduleResponse(row: EnergyManagementSchedule) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      stationId: row.stationId,
      groupId: row.groupId,
      planId: row.planId,
      status: row.status,
      source: row.source,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      entries: row.entries,
      fallbackToDlm: row.fallbackToDlm,
      notes: row.notes,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toPlanRunResponse(row: EnergyPlanRun) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      planId: row.planId,
      scheduleId: row.scheduleId,
      stationId: row.stationId,
      groupId: row.groupId,
      trigger: row.trigger,
      state: row.state,
      message: row.message,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      metrics: row.metrics,
      output: row.output,
      initiatedBy: row.initiatedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async applyPlan(
    group: GroupBundle,
    bundle: Awaited<ReturnType<typeof this.loadBundle>>,
    plan: EnergyAllocationPlan,
    input: RecalculateInput,
  ) {
    if (
      input.dryRun ||
      group.observeOnly ||
      group.controlMode === 'OBSERVE_ONLY'
    ) {
      return [];
    }

    const now = new Date();
    const results: Array<Record<string, unknown>> = [];

    for (const allocation of plan.allocations) {
      if (!allocation.shouldSendCommand) continue;
      const membership = bundle.memberships.find(
        (row) => row.chargePointId === allocation.chargePointId,
      );
      if (!membership) continue;

      const chargePoint = bundle.chargePointMap.get(allocation.chargePointId);
      if (!chargePoint) continue;

      const command = await this.commands.enqueueCommand({
        commandType:
          allocation.commandType === 'ClearChargingLimit'
            ? 'ClearChargingLimit'
            : 'ApplyChargingLimit',
        tenantId: group.tenantId,
        stationId: group.stationId,
        chargePointId: allocation.chargePointId,
        payload: {
          groupId: group.id,
          stationId: group.stationId,
          chargePointId: allocation.chargePointId,
          decisionHash: plan.decisionHash,
          reasonCode: plan.reasonCode,
          controlMode: group.controlMode,
          allocationMethod: group.allocationMethod,
          limitAmps: allocation.targetAmps,
          effectiveLimitAmps: plan.effectiveLimitAmps,
          headroomAmps: plan.headroomAmps,
          failSafeCeilingAmps: plan.failSafeCeilingAmps,
          siteLimitAmps: plan.siteLimitAmps,
          nonEvLoadAmps: plan.nonEvLoadAmps,
          dynamicBufferAmps: plan.dynamicBufferAmps,
          telemetryAgeSec: plan.telemetryAgeSec,
        },
        requestedBy: { userId: 'system', orgId: group.tenantId },
        correlationId: this.buildDedupeKey(
          group.id,
          allocation.chargePointId,
          allocation.targetAmps,
          plan.reasonCode,
        ),
        idempotencyTtlSec: group.commandRefreshSec,
      });

      results.push({
        commandId: command.commandId,
        status: command.status,
        chargePointId: allocation.chargePointId,
        targetAmps: allocation.targetAmps,
      });

      await this.prisma.energyLoadGroupMembership.updateMany({
        where: { groupId: group.id, chargePointId: allocation.chargePointId },
        data: {
          lastAppliedAmps: allocation.targetAmps,
          lastAppliedDecisionHash: plan.decisionHash,
          lastCommandAt: now,
          lastCommandId: command.commandId,
          lastCommandStatus: command.status,
        },
      });

      if (!chargePoint.smartChargingEnabled) {
        await this.prisma.energyAlert.create({
          data: {
            groupId: group.id,
            code: 'CHARGER_EXCLUDED',
            severity: 'INFO',
            title: 'Smart charging disabled on charge point',
            message: `${chargePoint.ocppId} is not smart-charging capable and was excluded from automatic allocation.`,
            metadata: {
              chargePointId: allocation.chargePointId,
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    return results;
  }

  private async decorateGroup(
    id: string,
    includeDetails = false,
    decisionId?: string,
    plan?: EnergyAllocationPlan,
    commandResults?: Array<Record<string, unknown>>,
  ) {
    const group = await this.loadGroupOrThrow(id);
    const bundle = await this.loadBundle(group);
    const station = await this.prisma.station.findUnique({
      where: { id: group.stationId },
      select: { id: true, name: true, status: true },
    });
    const activeSessions = await this.prisma.session.count({
      where: { stationId: group.stationId, status: 'ACTIVE' },
    });

    const resolvedPlan =
      plan ||
      buildEnergyAllocationPlan({
        groupId: group.id,
        controlMode: group.controlMode as EnergyControlMode,
        observeOnly: group.observeOnly,
        allocationMethod: group.allocationMethod as EnergyAllocationMethod,
        siteLimitAmps: this.toPhaseTriple(group, 'siteLimit'),
        nonEvLoadAmps: this.toPhaseTriple(group, 'nonEvLoad'),
        dynamicBufferAmps: this.toPhaseTriple(group, 'dynamicBuffer'),
        failSafeAmps: this.toPhaseTriple(group, 'failSafe'),
        deadbandAmps: group.deadbandAmps,
        staleWarningAfterSec: group.staleWarningAfterSec,
        failSafeAfterSec: group.failSafeAfterSec,
        commandRefreshSec: group.commandRefreshSec,
        nowIso: new Date().toISOString(),
        telemetry: bundle.latestTelemetry
          ? {
              sampledAt: bundle.latestTelemetry.sampledAt.toISOString(),
              freshnessSec: bundle.latestTelemetry.freshnessSec,
              meterSource: bundle.latestTelemetry.meterSource,
            }
          : null,
        override: bundle.activeOverride
          ? {
              active: true,
              capAmps: bundle.activeOverride.capAmps,
              expiresAt: bundle.activeOverride.expiresAt.toISOString(),
            }
          : null,
        memberships: bundle.memberships.map((membership) => ({
          chargePointId: membership.chargePointId,
          enabled: membership.enabled,
          priority: membership.priority,
          smartChargingEnabled: this.resolveChargePointCapability(
            bundle.chargePointMap.get(membership.chargePointId),
            membership.smartChargingEnabled,
          ),
          chargePointOnline: this.resolveChargePointAvailability(
            bundle.chargePointMap.get(membership.chargePointId),
          ),
          maxAmps: membership.maxAmps,
          lastAppliedAmps: membership.lastAppliedAmps,
          lastAppliedDecisionHash: membership.lastAppliedDecisionHash,
          lastCommandAt: membership.lastCommandAt?.toISOString() || null,
        })),
      });

    const summary = {
      id: group.id,
      tenantId: group.tenantId,
      stationId: group.stationId,
      stationName: station?.name || group.stationId,
      stationStatus: station?.status || 'UNKNOWN',
      name: group.name,
      description: group.description,
      controlMode: group.controlMode,
      allocationMethod: group.allocationMethod,
      meterSource: group.meterSource,
      meterPlacement: group.meterPlacement,
      observeOnly: group.observeOnly,
      isActive: group.isActive,
      siteLimit: this.toPhaseTriple(group, 'siteLimit'),
      dynamicBuffer: this.toPhaseTriple(group, 'dynamicBuffer'),
      failSafe: this.toPhaseTriple(group, 'failSafe'),
      nonEvLoad: this.toPhaseTriple(group, 'nonEvLoad'),
      headroom: resolvedPlan.headroomAmps,
      effectiveLimitAmps: resolvedPlan.effectiveLimitAmps,
      activeSessions,
      activeMembers: resolvedPlan.activeChargePointCount,
      telemetryAgeSec: resolvedPlan.telemetryAgeSec,
      telemetryStatus: this.deriveTelemetryStatus(resolvedPlan),
      latestDecisionHash: group.latestDecisionHash,
      latestDecisionAt: group.latestDecisionAt
        ? group.latestDecisionAt.toISOString()
        : null,
      latestAppliedAt: group.latestAppliedAt
        ? group.latestAppliedAt.toISOString()
        : null,
      latestReasonCode: group.latestReasonCode,
      commandRefreshSec: group.commandRefreshSec,
      deadbandAmps: group.deadbandAmps,
      alertCount: bundle.alerts.length,
      activeAlertCount: bundle.alerts.filter((alert) => alert.status === 'OPEN')
        .length,
      activeOverride: bundle.activeOverride
        ? {
            id: bundle.activeOverride.id,
            status: bundle.activeOverride.status,
            reason: bundle.activeOverride.reason,
            capAmps: bundle.activeOverride.capAmps,
            expiresAt: bundle.activeOverride.expiresAt.toISOString(),
          }
        : null,
    };

    if (!includeDetails) {
      return {
        ...summary,
        currentLoadAmps: this.sumPhaseTriple(resolvedPlan.nonEvLoadAmps),
      };
    }

    return {
      ...summary,
      currentDecisionId: decisionId || null,
      currentDecision: plan
        ? { plan, commandResults: commandResults || [] }
        : null,
      memberships: bundle.memberships.map((membership) => ({
        id: membership.id,
        chargePointId: membership.chargePointId,
        ocppId:
          bundle.chargePointMap.get(membership.chargePointId)?.ocppId ||
          membership.chargePointId,
        smartChargingEnabled: this.resolveChargePointCapability(
          bundle.chargePointMap.get(membership.chargePointId),
          membership.smartChargingEnabled,
        ),
        chargePointOnline: this.resolveChargePointAvailability(
          bundle.chargePointMap.get(membership.chargePointId),
        ),
        enabled: membership.enabled,
        priority: membership.priority,
        maxAmps: membership.maxAmps,
        lastAppliedAmps: membership.lastAppliedAmps,
        lastCommandAt: membership.lastCommandAt
          ? membership.lastCommandAt.toISOString()
          : null,
        lastCommandStatus: membership.lastCommandStatus,
      })),
      telemetry: bundle.telemetrySnapshots.map((snapshot) => ({
        id: snapshot.id,
        sampledAt: snapshot.sampledAt.toISOString(),
        freshnessSec: snapshot.freshnessSec,
        meterSource: snapshot.meterSource,
        meterPlacement: snapshot.meterPlacement,
        siteLoadAmps: {
          phase1: snapshot.siteLoadAmpsPhase1,
          phase2: snapshot.siteLoadAmpsPhase2,
          phase3: snapshot.siteLoadAmpsPhase3,
        },
        nonEvLoadAmps: {
          phase1: snapshot.nonEvLoadAmpsPhase1,
          phase2: snapshot.nonEvLoadAmpsPhase2,
          phase3: snapshot.nonEvLoadAmpsPhase3,
        },
        headroomAmps: {
          phase1: snapshot.headroomAmpsPhase1,
          phase2: snapshot.headroomAmpsPhase2,
          phase3: snapshot.headroomAmpsPhase3,
        },
        reasonCode: snapshot.reasonCode,
      })),
      decisions: bundle.allocationDecisions.map((decision) => ({
        id: decision.id,
        createdAt: decision.createdAt.toISOString(),
        appliedAt: decision.appliedAt ? decision.appliedAt.toISOString() : null,
        decisionHash: decision.decisionHash,
        reasonCode: decision.reasonCode,
        state: decision.state,
        commandCount: decision.commandCount,
        triggeredBy: decision.triggeredBy,
        inputSnapshot: decision.inputSnapshot,
        outputSnapshot: decision.outputSnapshot,
      })),
      alerts: bundle.alerts.map((alert) => ({
        id: alert.id,
        code: alert.code,
        severity: alert.severity,
        status: alert.status,
        title: alert.title,
        message: alert.message,
        createdAt: alert.createdAt.toISOString(),
        acknowledgedAt: alert.acknowledgedAt
          ? alert.acknowledgedAt.toISOString()
          : null,
        acknowledgedBy: alert.acknowledgedBy,
      })),
      manualOverrides: bundle.manualOverrides.map((override) => ({
        id: override.id,
        status: override.status,
        reason: override.reason,
        requestedBy: override.requestedBy,
        capAmps: override.capAmps,
        expiresAt: override.expiresAt.toISOString(),
        clearedAt: override.clearedAt ? override.clearedAt.toISOString() : null,
        createdAt: override.createdAt.toISOString(),
      })),
    };
  }

  private async loadGroupOrThrow(id: string): Promise<GroupBundle> {
    const tenantId = this.resolveTenantId();
    const group = await this.prisma.energyLoadGroup.findUnique({
      where: { id },
      include: {
        memberships: true,
        telemetrySnapshots: true,
        allocationDecisions: true,
        alerts: true,
        manualOverrides: true,
      },
    });

    if (!group || group.tenantId !== tenantId) {
      throw new NotFoundException('Energy load group not found');
    }

    return group;
  }

  private async loadBundle(group: GroupBundle): Promise<ResolvedBundle> {
    const memberships = [...group.memberships];
    const telemetrySnapshots = [...group.telemetrySnapshots].sort(
      (left, right) => right.sampledAt.getTime() - left.sampledAt.getTime(),
    );
    const allocationDecisions = [...group.allocationDecisions].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    const alerts = [...group.alerts].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    const manualOverrides = [...group.manualOverrides].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

    const latestTelemetry = telemetrySnapshots[0] || null;
    const now = Date.now();
    const activeOverride =
      manualOverrides.find(
        (override) =>
          override.status === 'ACTIVE' && override.expiresAt.getTime() > now,
      ) || null;

    const chargePointIds = memberships.map(
      (membership) => membership.chargePointId,
    );
    const chargePoints = chargePointIds.length
      ? await this.prisma.chargePoint.findMany({
          where: { id: { in: chargePointIds } },
          select: {
            id: true,
            ocppId: true,
            status: true,
            smartChargingEnabled: true,
          },
        })
      : [];

    const chargePointMap = new Map<string, BundleChargePoint>();
    for (const chargePoint of chargePoints) {
      chargePointMap.set(chargePoint.id, {
        id: chargePoint.id,
        ocppId: chargePoint.ocppId,
        status: chargePoint.status,
        smartChargingEnabled: chargePoint.smartChargingEnabled,
      });
    }

    return {
      memberships,
      telemetrySnapshots,
      allocationDecisions,
      alerts,
      manualOverrides,
      latestTelemetry,
      activeOverride,
      chargePointMap,
    };
  }

  private async withLock<T>(
    key: string,
    handler: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(key) || Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    this.locks.set(key, current);

    await previous.catch(() => undefined);
    try {
      return await handler();
    } finally {
      release();
      if (this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    }
  }

  private resolveTenantId(): string {
    const tenantId = this.resolveTenantIdOrNull();
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }
    return tenantId;
  }

  private resolveTenantIdOrNull(): string | null {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId ||
      context?.authenticatedOrganizationId ||
      null;
    return tenantId;
  }

  private async assertStationExists(stationId: string): Promise<{
    id: string;
    siteId: string | null;
    organizationId: string;
  }> {
    const tenantId = this.resolveTenantId();
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
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

    const stationTenantId =
      station.orgId || station.site?.organizationId || null;
    if (stationTenantId && stationTenantId !== tenantId) {
      throw new NotFoundException('Station not found');
    }

    return {
      id: station.id,
      siteId: station.siteId ?? null,
      organizationId: stationTenantId || tenantId,
    };
  }

  private normalizeDerStatus(value: unknown): string | null {
    const normalized = this.readString(value)?.toUpperCase();
    if (!normalized) return null;
    if (!DER_PROFILE_STATUS.has(normalized)) {
      throw new BadRequestException(
        `Invalid DER profile status "${String(value)}". Allowed values: ${Array.from(DER_PROFILE_STATUS).join(', ')}`,
      );
    }
    return normalized;
  }

  private buildDerConstraintSummary(
    profile: {
      status: string;
      maxGridImportKw: number | null;
      reserveGridKw: number | null;
      solarEnabled: boolean;
      maxSolarContributionKw: number | null;
      bessEnabled: boolean;
      maxBessDischargeKw: number | null;
      bessSocPercent: number | null;
      bessReserveSocPercent: number | null;
    } | null,
  ): Record<string, unknown> {
    if (!profile || profile.status !== 'ACTIVE') {
      return {
        profileActive: false,
        gridHeadroomKw: null,
        solarContributionKw: 0,
        bessContributionKw: 0,
        totalAvailableKw: null,
        effectiveMaxChargingAmps: null,
        bessDischargeAllowed: false,
      };
    }

    const gridHeadroomKw =
      profile.maxGridImportKw === null
        ? null
        : Math.max(0, profile.maxGridImportKw - (profile.reserveGridKw ?? 0));
    const solarContributionKw = profile.solarEnabled
      ? Math.max(0, profile.maxSolarContributionKw ?? 0)
      : 0;
    const bessDischargeAllowed =
      profile.bessEnabled &&
      (profile.bessSocPercent ?? 100) > (profile.bessReserveSocPercent ?? 0);
    const bessContributionKw = bessDischargeAllowed
      ? Math.max(0, profile.maxBessDischargeKw ?? 0)
      : 0;

    const totalAvailableKw =
      (gridHeadroomKw ?? 0) + solarContributionKw + bessContributionKw;
    const effectiveMaxChargingAmps = Math.max(
      0,
      Math.floor((totalAvailableKw * 1000) / (3 * 230)),
    );

    return {
      profileActive: true,
      gridHeadroomKw,
      solarContributionKw,
      bessContributionKw,
      totalAvailableKw: Number(totalAvailableKw.toFixed(4)),
      effectiveMaxChargingAmps,
      bessDischargeAllowed,
    };
  }

  private toDerProfileResponse(profile: {
    id: string;
    tenantId: string;
    organizationId: string;
    stationId: string;
    siteId: string | null;
    status: string;
    maxGridImportKw: number | null;
    reserveGridKw: number | null;
    solarEnabled: boolean;
    maxSolarContributionKw: number | null;
    bessEnabled: boolean;
    maxBessDischargeKw: number | null;
    bessSocPercent: number | null;
    bessReserveSocPercent: number | null;
    forecast: Prisma.JsonValue | null;
    metadata: Prisma.JsonValue | null;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Record<string, unknown> {
    return {
      id: profile.id,
      tenantId: profile.tenantId,
      organizationId: profile.organizationId,
      stationId: profile.stationId,
      siteId: profile.siteId,
      status: profile.status,
      maxGridImportKw: profile.maxGridImportKw,
      reserveGridKw: profile.reserveGridKw,
      solarEnabled: profile.solarEnabled,
      maxSolarContributionKw: profile.maxSolarContributionKw,
      bessEnabled: profile.bessEnabled,
      maxBessDischargeKw: profile.maxBessDischargeKw,
      bessSocPercent: profile.bessSocPercent,
      bessReserveSocPercent: profile.bessReserveSocPercent,
      forecast: profile.forecast,
      metadata: profile.metadata,
      createdBy: profile.createdBy,
      updatedBy: profile.updatedBy,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private readOptionalBooleanInput(
    value: unknown,
    field: string,
  ): boolean | undefined {
    if (value === undefined) return undefined;
    const parsed = this.readBoolean(value);
    if (parsed === undefined) {
      throw new BadRequestException(`${field} must be a boolean value`);
    }
    return parsed;
  }

  private readOptionalNonNegativeFloatInput(
    value: unknown,
    field: string,
  ): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException(
        `${field} must be a non-negative numeric value`,
      );
    }
    return Number(parsed.toFixed(4));
  }

  private readOptionalPercentInput(
    value: unknown,
    field: string,
  ): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new BadRequestException(
        `${field} must be a numeric percentage between 0 and 100`,
      );
    }
    return Number(parsed.toFixed(2));
  }

  private normalizeOptionalJsonInput(
    value: unknown,
    field: string,
  ): Prisma.InputJsonValue | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'object') {
      throw new BadRequestException(
        `${field} must be a JSON object or array when provided`,
      );
    }
    return value as Prisma.InputJsonValue;
  }

  private normalizeControlMode(value: unknown): EnergyControlMode | null {
    const normalized = this.readString(value)
      ?.replace(/[\s-]+/g, '_')
      .toUpperCase();
    if (
      normalized === 'OBSERVE_ONLY' ||
      normalized === 'ACTIVE' ||
      normalized === 'DISABLED'
    ) {
      return normalized;
    }
    return null;
  }

  private normalizeAllocationMethod(
    value: unknown,
  ): EnergyAllocationMethod | null {
    const normalized = this.readString(value)
      ?.replace(/[\s-]+/g, '_')
      .toUpperCase();
    if (normalized === 'EQUAL' || normalized === 'PRIORITY') {
      return normalized;
    }
    return null;
  }

  private normalizeMeterPlacement(value: unknown): EnergyMeterPlacement | null {
    const normalized = this.readString(value)
      ?.replace(/[\s-]+/g, '_')
      .toUpperCase();
    if (
      normalized === 'MAIN' ||
      normalized === 'SUB_FEEDER' ||
      normalized === 'DERIVED'
    ) {
      return normalized;
    }
    return null;
  }

  private normalizeScheduleStatus(value: unknown): string | null {
    const normalized = this.readString(value)
      ?.replace(/[\s-]+/g, '_')
      .toUpperCase();
    if (!normalized) return null;
    if (
      [
        'DRAFT',
        'PENDING_APPROVAL',
        'APPROVED',
        'ACTIVE',
        'SUPERSEDED',
        'CANCELLED',
        'FALLBACK_DLM',
      ].includes(normalized)
    ) {
      return normalized;
    }
    return null;
  }

  private normalizePlanRunState(value: unknown): string | null {
    const normalized = this.readString(value)
      ?.replace(/[\s-]+/g, '_')
      .toUpperCase();
    if (!normalized) return null;
    if (
      [
        'PREVIEW',
        'DRY_RUN',
        'QUEUED',
        'APPLIED',
        'FAILED',
        'FALLBACK_DLM',
      ].includes(normalized)
    ) {
      return normalized;
    }
    return null;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readOptionalString(value: unknown): string | undefined {
    return this.readString(value);
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private readBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return undefined;
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return undefined;
  }

  private readPositiveInt(value: unknown): number | null {
    const parsed = this.readNumber(value);
    if (parsed === null) return null;
    return parsed > 0 ? parsed : null;
  }

  private readNonNegativeInt(value: unknown): number | null {
    const parsed = this.readNumber(value);
    if (parsed === null) return null;
    return parsed >= 0 ? parsed : null;
  }

  private readNumber(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.floor(parsed);
  }

  private parseDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  }

  private normalizeMembershipInputs(memberships: MembershipInput[]): Array<{
    chargePointId: string;
    priority: number;
    enabled: boolean;
    maxAmps: number | null;
  }> {
    const normalized: Array<{
      chargePointId: string;
      priority: number;
      enabled: boolean;
      maxAmps: number | null;
    }> = [];
    const seen = new Set<string>();

    for (const membership of memberships) {
      const record = this.readRecord(membership);
      if (!record) {
        throw new BadRequestException('Each membership must be an object');
      }

      const chargePointId = this.readString(record.chargePointId);
      if (!chargePointId) {
        throw new BadRequestException('membership.chargePointId is required');
      }
      if (seen.has(chargePointId)) {
        throw new BadRequestException(
          `Duplicate membership for charge point ${chargePointId}`,
        );
      }
      seen.add(chargePointId);

      normalized.push({
        chargePointId,
        priority: this.readNonNegativeInt(record.priority) ?? 0,
        enabled: this.readBoolean(record.enabled) ?? true,
        maxAmps: this.readNonNegativeInt(record.maxAmps),
      });
    }

    return normalized;
  }

  private toPhaseTripleFromRecord(
    input: Record<string, unknown>,
    key: string,
  ): PhaseTriple {
    const nested =
      this.readRecord(input[key]) ??
      this.readRecord(input[`${key}Amps`]) ??
      this.readRecord(input[`${key}Load`]);

    if (nested) {
      return this.toPhaseTripleValue(nested);
    }

    return {
      phase1:
        this.readNonNegativeInt(
          input[`${key}Phase1`] ??
            input[`${key}AmpsPhase1`] ??
            input[`${key}_phase_1`] ??
            input[`${key}_amps_phase_1`],
        ) ?? 0,
      phase2:
        this.readNonNegativeInt(
          input[`${key}Phase2`] ??
            input[`${key}AmpsPhase2`] ??
            input[`${key}_phase_2`] ??
            input[`${key}_amps_phase_2`],
        ) ?? 0,
      phase3:
        this.readNonNegativeInt(
          input[`${key}Phase3`] ??
            input[`${key}AmpsPhase3`] ??
            input[`${key}_phase_3`] ??
            input[`${key}_amps_phase_3`],
        ) ?? 0,
    };
  }

  private toPhaseTripleValue(value: Record<string, unknown>): PhaseTriple {
    return {
      phase1:
        this.readNonNegativeInt(
          value.phase1 ??
            value.phase_1 ??
            value.l1 ??
            value.currentPhase1 ??
            value.ampsPhase1 ??
            value.phase1Amps,
        ) ?? 0,
      phase2:
        this.readNonNegativeInt(
          value.phase2 ??
            value.phase_2 ??
            value.l2 ??
            value.currentPhase2 ??
            value.ampsPhase2 ??
            value.phase2Amps,
        ) ?? 0,
      phase3:
        this.readNonNegativeInt(
          value.phase3 ??
            value.phase_3 ??
            value.l3 ??
            value.currentPhase3 ??
            value.ampsPhase3 ??
            value.phase3Amps,
        ) ?? 0,
    };
  }

  private toPhaseTriple(
    group: GroupBundle,
    kind: 'siteLimit' | 'nonEvLoad' | 'dynamicBuffer' | 'failSafe',
  ): PhaseTriple {
    switch (kind) {
      case 'siteLimit':
        return {
          phase1: this.readNonNegativeInt(group.siteLimitAmpsPhase1) ?? 0,
          phase2: this.readNonNegativeInt(group.siteLimitAmpsPhase2) ?? 0,
          phase3: this.readNonNegativeInt(group.siteLimitAmpsPhase3) ?? 0,
        };
      case 'nonEvLoad':
        return {
          phase1: this.readNonNegativeInt(group.lastNonEvLoadAmpsPhase1) ?? 0,
          phase2: this.readNonNegativeInt(group.lastNonEvLoadAmpsPhase2) ?? 0,
          phase3: this.readNonNegativeInt(group.lastNonEvLoadAmpsPhase3) ?? 0,
        };
      case 'dynamicBuffer':
        return {
          phase1: this.readNonNegativeInt(group.dynamicBufferAmpsPhase1) ?? 0,
          phase2: this.readNonNegativeInt(group.dynamicBufferAmpsPhase2) ?? 0,
          phase3: this.readNonNegativeInt(group.dynamicBufferAmpsPhase3) ?? 0,
        };
      case 'failSafe':
        return {
          phase1: this.readNonNegativeInt(group.failSafeAmpsPhase1) ?? 0,
          phase2: this.readNonNegativeInt(group.failSafeAmpsPhase2) ?? 0,
          phase3: this.readNonNegativeInt(group.failSafeAmpsPhase3) ?? 0,
        };
    }

    return { phase1: 0, phase2: 0, phase3: 0 };
  }

  private sumPhaseTriple(value: PhaseTriple): number {
    return value.phase1 + value.phase2 + value.phase3;
  }

  private deriveTelemetryStatus(plan: EnergyAllocationPlan): string {
    if (plan.isTelemetryFailSafe) return 'FAIL_SAFE';
    if (plan.isTelemetryStale) return 'STALE';
    if (plan.telemetryAgeSec === null) return 'MISSING';
    return 'FRESH';
  }

  private buildDedupeKey(
    groupId: string,
    chargePointId: string,
    targetAmps: number,
    reasonCode: string,
  ): string {
    return ['ems', groupId, chargePointId, String(targetAmps), reasonCode].join(
      ':',
    );
  }

  private toDecisionGroupSnapshot(group: GroupBundle): Record<string, unknown> {
    return {
      id: group.id,
      tenantId: group.tenantId,
      stationId: group.stationId,
      name: group.name,
      description: group.description,
      controlMode: group.controlMode,
      allocationMethod: group.allocationMethod,
      meterSource: group.meterSource,
      meterPlacement: group.meterPlacement,
      observeOnly: group.observeOnly,
      isActive: group.isActive,
      siteLimit: this.toPhaseTriple(group, 'siteLimit'),
      dynamicBuffer: this.toPhaseTriple(group, 'dynamicBuffer'),
      failSafe: this.toPhaseTriple(group, 'failSafe'),
      nonEvLoad: this.toPhaseTriple(group, 'nonEvLoad'),
      headroom: this.calculateHeadroom(group),
      deadbandAmps: group.deadbandAmps,
      staleWarningAfterSec: group.staleWarningAfterSec,
      failSafeAfterSec: group.failSafeAfterSec,
      commandRefreshSec: group.commandRefreshSec,
      latestTelemetryAt: group.latestTelemetryAt
        ? group.latestTelemetryAt.toISOString()
        : null,
      latestDecisionAt: group.latestDecisionAt
        ? group.latestDecisionAt.toISOString()
        : null,
      latestDecisionHash: group.latestDecisionHash,
      latestAppliedAt: group.latestAppliedAt
        ? group.latestAppliedAt.toISOString()
        : null,
      latestReasonCode: group.latestReasonCode,
      lastMeterFreshnessSec: group.lastMeterFreshnessSec,
      activeAlertCount: group.alerts.filter((alert) => alert.status === 'OPEN')
        .length,
      activeOverrideCount: group.manualOverrides.filter(
        (override) =>
          override.status === 'ACTIVE' &&
          override.expiresAt.getTime() > Date.now(),
      ).length,
      membershipCount: group.memberships.length,
    };
  }

  private toDecisionTelemetrySnapshot(
    snapshot: GroupBundle['telemetrySnapshots'][number],
  ): Record<string, unknown> {
    return {
      id: snapshot.id,
      sampledAt: snapshot.sampledAt.toISOString(),
      meterSource: snapshot.meterSource,
      meterPlacement: snapshot.meterPlacement,
      freshnessSec: snapshot.freshnessSec,
      siteLoadAmps: {
        phase1: snapshot.siteLoadAmpsPhase1,
        phase2: snapshot.siteLoadAmpsPhase2,
        phase3: snapshot.siteLoadAmpsPhase3,
      },
      nonEvLoadAmps: {
        phase1: snapshot.nonEvLoadAmpsPhase1,
        phase2: snapshot.nonEvLoadAmpsPhase2,
        phase3: snapshot.nonEvLoadAmpsPhase3,
      },
      availableAmps: {
        phase1: snapshot.availableAmpsPhase1,
        phase2: snapshot.availableAmpsPhase2,
        phase3: snapshot.availableAmpsPhase3,
      },
      headroomAmps: {
        phase1: snapshot.headroomAmpsPhase1,
        phase2: snapshot.headroomAmpsPhase2,
        phase3: snapshot.headroomAmpsPhase3,
      },
      reasonCode: snapshot.reasonCode,
    };
  }

  private toDecisionOverrideSnapshot(
    override: GroupBundle['manualOverrides'][number],
  ): Record<string, unknown> {
    return {
      id: override.id,
      status: override.status,
      reason: override.reason,
      requestedBy: override.requestedBy,
      capAmps: override.capAmps,
      expiresAt: override.expiresAt.toISOString(),
      clearedAt: override.clearedAt ? override.clearedAt.toISOString() : null,
      createdAt: override.createdAt.toISOString(),
    };
  }

  private toDecisionMembershipSnapshot(
    membership: GroupBundle['memberships'][number],
    chargePoint?: BundleChargePoint,
  ): Record<string, unknown> {
    return {
      id: membership.id,
      chargePointId: membership.chargePointId,
      priority: membership.priority,
      enabled: membership.enabled,
      smartChargingEnabled: this.resolveChargePointCapability(
        chargePoint,
        membership.smartChargingEnabled,
      ),
      chargePointOnline: this.resolveChargePointAvailability(chargePoint),
      maxAmps: membership.maxAmps,
      lastAppliedAmps: membership.lastAppliedAmps,
      lastAppliedDecisionHash: membership.lastAppliedDecisionHash,
      lastCommandAt: membership.lastCommandAt
        ? membership.lastCommandAt.toISOString()
        : null,
      lastCommandId: membership.lastCommandId,
      lastCommandStatus: membership.lastCommandStatus,
    };
  }

  private resolveChargePointCapability(
    chargePoint: BundleChargePoint | undefined,
    membershipCapability: boolean,
  ): boolean {
    if (!chargePoint) return false;
    return chargePoint.smartChargingEnabled && membershipCapability;
  }

  private resolveChargePointAvailability(
    chargePoint: BundleChargePoint | undefined,
  ): boolean {
    if (!chargePoint) return false;
    const normalizedStatus = chargePoint.status.trim().toLowerCase();
    return [
      'online',
      'available',
      'charging',
      'occupied',
      'preparing',
      'reserved',
      'suspendedev',
      'suspendedevse',
      'finishing',
    ].includes(normalizedStatus);
  }

  private calculateHeadroom(group: GroupBundle): PhaseTriple {
    const site1 = this.readNonNegativeInt(group.siteLimitAmpsPhase1) ?? 0;
    const site2 = this.readNonNegativeInt(group.siteLimitAmpsPhase2) ?? 0;
    const site3 = this.readNonNegativeInt(group.siteLimitAmpsPhase3) ?? 0;
    const nonEv1 = this.readNonNegativeInt(group.lastNonEvLoadAmpsPhase1) ?? 0;
    const nonEv2 = this.readNonNegativeInt(group.lastNonEvLoadAmpsPhase2) ?? 0;
    const nonEv3 = this.readNonNegativeInt(group.lastNonEvLoadAmpsPhase3) ?? 0;
    const buffer1 = this.readNonNegativeInt(group.dynamicBufferAmpsPhase1) ?? 0;
    const buffer2 = this.readNonNegativeInt(group.dynamicBufferAmpsPhase2) ?? 0;
    const buffer3 = this.readNonNegativeInt(group.dynamicBufferAmpsPhase3) ?? 0;

    return {
      phase1: Math.max(0, site1 - nonEv1 - buffer1),
      phase2: Math.max(0, site2 - nonEv2 - buffer2),
      phase3: Math.max(0, site3 - nonEv3 - buffer3),
    };
  }

  private async recordAuditEvent(input: {
    actorId: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    status?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor: input.actorId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          details: input.details as Prisma.InputJsonValue | undefined,
          status: input.status || 'SUCCESS',
          errorMessage: input.errorMessage,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record energy management audit event ${input.action}`,
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }
}
