import { createHash } from 'crypto';

export type EnergyControlMode = 'OBSERVE_ONLY' | 'ACTIVE' | 'DISABLED';
export type EnergyAllocationMethod = 'EQUAL' | 'PRIORITY';
export type EnergyDecisionState =
  | 'APPLIED'
  | 'DRY_RUN'
  | 'NO_CHANGE'
  | 'BLOCKED'
  | 'FAILED';

export type PhaseTriple = {
  phase1: number;
  phase2: number;
  phase3: number;
};

export type EnergyAllocationCommandType =
  | 'ApplyChargingLimit'
  | 'ClearChargingLimit'
  | 'None';

export type EnergyAlertCode =
  | 'METER_STALE'
  | 'METER_FAILSAFE'
  | 'MANUAL_OVERRIDE'
  | 'CHARGER_EXCLUDED'
  | 'NO_ACTIVE_CHARGERS'
  | 'GROUP_DISABLED';

export interface EnergyAllocationMemberInput {
  chargePointId: string;
  enabled: boolean;
  priority: number;
  smartChargingEnabled: boolean;
  chargePointOnline: boolean;
  maxAmps?: number | null;
  lastAppliedAmps?: number | null;
  lastAppliedDecisionHash?: string | null;
  lastCommandAt?: string | null;
}

export interface EnergyTelemetryState {
  sampledAt?: string | null;
  freshnessSec?: number | null;
  meterSource?: string | null;
}

export interface EnergyOverrideState {
  active: boolean;
  capAmps?: number | null;
  expiresAt?: string | null;
}

export interface EnergyAllocationPlanInput {
  groupId: string;
  controlMode: EnergyControlMode;
  observeOnly: boolean;
  allocationMethod: EnergyAllocationMethod;
  siteLimitAmps: PhaseTriple;
  nonEvLoadAmps: PhaseTriple;
  dynamicBufferAmps: PhaseTriple;
  failSafeAmps: PhaseTriple;
  deadbandAmps: number;
  staleWarningAfterSec: number;
  failSafeAfterSec: number;
  commandRefreshSec: number;
  nowIso: string;
  telemetry?: EnergyTelemetryState | null;
  override?: EnergyOverrideState | null;
  memberships: EnergyAllocationMemberInput[];
}

export interface EnergyAllocationMemberPlan {
  chargePointId: string;
  enabled: boolean;
  priority: number;
  smartChargingEnabled: boolean;
  previousAmps: number | null;
  targetAmps: number;
  commandType: EnergyAllocationCommandType;
  shouldSendCommand: boolean;
  reasonCode: string;
}

export interface EnergyAllocationPlan {
  decisionHash: string;
  state: EnergyDecisionState;
  reasonCode: string;
  alerts: EnergyAlertCode[];
  telemetryAgeSec: number | null;
  isTelemetryStale: boolean;
  isTelemetryFailSafe: boolean;
  siteLimitAmps: PhaseTriple;
  nonEvLoadAmps: PhaseTriple;
  dynamicBufferAmps: PhaseTriple;
  headroomAmps: PhaseTriple;
  failSafeCeilingAmps: PhaseTriple;
  overrideCapAmps: number | null;
  effectiveLimitAmps: number;
  activeChargePointCount: number;
  allocations: EnergyAllocationMemberPlan[];
}

export function buildEnergyAllocationPlan(
  input: EnergyAllocationPlanInput,
): EnergyAllocationPlan {
  const siteLimitAmps = normalizePhaseTriple(input.siteLimitAmps);
  const nonEvLoadAmps = normalizePhaseTriple(input.nonEvLoadAmps);
  const dynamicBufferAmps = normalizePhaseTriple(input.dynamicBufferAmps);
  const failSafeAmps = normalizePhaseTriple(input.failSafeAmps);

  const headroomAmps = subtractPhaseTriple(
    subtractPhaseTriple(siteLimitAmps, nonEvLoadAmps),
    dynamicBufferAmps,
  );
  const failSafeCeilingAmps = clampPhaseTriple(
    minPhaseTriple(headroomAmps, failSafeAmps),
  );

  const telemetryAgeSec = resolveTelemetryAgeSec(
    input.nowIso,
    input.telemetry?.sampledAt,
    input.telemetry?.freshnessSec,
  );
  const isTelemetryStale =
    telemetryAgeSec !== null &&
    telemetryAgeSec >= Math.max(0, Math.floor(input.staleWarningAfterSec));
  const isTelemetryFailSafe =
    telemetryAgeSec === null ||
    telemetryAgeSec >= Math.max(0, Math.floor(input.failSafeAfterSec));

  const overrideCapAmps = resolveOverrideCap(input.override, input.nowIso);
  const baseLimitAmps = resolveScalarLimit(failSafeCeilingAmps);
  const effectiveLimitAmps = Math.max(
    0,
    Math.min(
      baseLimitAmps,
      overrideCapAmps !== null ? overrideCapAmps : baseLimitAmps,
    ),
  );

  const activeMembers = input.memberships.filter(
    (membership) =>
      membership.enabled &&
      membership.smartChargingEnabled &&
      membership.chargePointOnline,
  );
  const excludedCount = input.memberships.length - activeMembers.length;

  const alertCodes: EnergyAlertCode[] = [];
  if (excludedCount > 0) {
    alertCodes.push('CHARGER_EXCLUDED');
  }
  if (activeMembers.length === 0) {
    alertCodes.push('NO_ACTIVE_CHARGERS');
  }
  if (isTelemetryStale) {
    alertCodes.push('METER_STALE');
  }
  if (isTelemetryFailSafe) {
    alertCodes.push('METER_FAILSAFE');
  }
  if (overrideCapAmps !== null) {
    alertCodes.push('MANUAL_OVERRIDE');
  }
  if (input.controlMode === 'DISABLED') {
    alertCodes.push('GROUP_DISABLED');
  }

  const allocations = allocateMembers({
    activeMembers,
    effectiveLimitAmps,
    allocationMethod: input.allocationMethod,
    deadbandAmps: Math.max(1, Math.floor(input.deadbandAmps || 1)),
    commandRefreshSec: Math.max(1, Math.floor(input.commandRefreshSec || 300)),
    nowIso: input.nowIso,
    controlMode: input.controlMode,
    observeOnly: input.observeOnly,
  });

  const state: EnergyDecisionState =
    input.controlMode === 'DISABLED'
      ? 'BLOCKED'
      : input.observeOnly
        ? 'DRY_RUN'
        : allocations.some((allocation) => allocation.shouldSendCommand)
          ? 'APPLIED'
          : 'NO_CHANGE';

  const reasonCode = deriveReasonCode({
    controlMode: input.controlMode,
    isTelemetryFailSafe,
    isTelemetryStale,
    overrideCapAmps,
    activeMembers,
    excludedCount,
  });

  const decisionHash = createHash('sha256')
    .update(
      JSON.stringify({
        groupId: input.groupId,
        controlMode: input.controlMode,
        observeOnly: input.observeOnly,
        allocationMethod: input.allocationMethod,
        siteLimitAmps,
        nonEvLoadAmps,
        dynamicBufferAmps,
        failSafeAmps,
        headroomAmps,
        failSafeCeilingAmps,
        overrideCapAmps,
        telemetryAgeSec,
        activeMembers: activeMembers.map((membership) => ({
          chargePointId: membership.chargePointId,
          priority: membership.priority,
          smartChargingEnabled: membership.smartChargingEnabled,
          chargePointOnline: membership.chargePointOnline,
          enabled: membership.enabled,
          previousAmps: membership.lastAppliedAmps ?? null,
          lastAppliedDecisionHash: membership.lastAppliedDecisionHash ?? null,
          lastCommandAt: membership.lastCommandAt ?? null,
        })),
        allocations: allocations.map((allocation) => ({
          chargePointId: allocation.chargePointId,
          targetAmps: allocation.targetAmps,
          commandType: allocation.commandType,
          shouldSendCommand: allocation.shouldSendCommand,
        })),
        reasonCode,
      }),
    )
    .digest('hex');

  return {
    decisionHash,
    state,
    reasonCode,
    alerts: Array.from(new Set(alertCodes)),
    telemetryAgeSec,
    isTelemetryStale,
    isTelemetryFailSafe,
    siteLimitAmps,
    nonEvLoadAmps,
    dynamicBufferAmps,
    headroomAmps,
    failSafeCeilingAmps,
    overrideCapAmps,
    effectiveLimitAmps,
    activeChargePointCount: activeMembers.length,
    allocations,
  };
}

function allocateMembers(input: {
  activeMembers: EnergyAllocationMemberInput[];
  effectiveLimitAmps: number;
  allocationMethod: EnergyAllocationMethod;
  deadbandAmps: number;
  commandRefreshSec: number;
  nowIso: string;
  controlMode: EnergyControlMode;
  observeOnly: boolean;
}): EnergyAllocationMemberPlan[] {
  const sortedMembers = [...input.activeMembers].sort((left, right) =>
    left.priority === right.priority
      ? left.chargePointId.localeCompare(right.chargePointId)
      : left.priority - right.priority,
  );

  const rawTargets =
    input.allocationMethod === 'PRIORITY'
      ? allocatePriority(sortedMembers, input.effectiveLimitAmps)
      : allocateEqual(sortedMembers, input.effectiveLimitAmps);

  return sortedMembers.map((member, index) => {
    const targetAmps = clampToMemberLimit(
      rawTargets[index] ?? 0,
      member.maxAmps,
    );
    const previousAmps = normalizeOptionalInt(member.lastAppliedAmps);
    const refreshWindowExpired = hasRefreshWindowExpired(
      member.lastCommandAt,
      input.nowIso,
      input.commandRefreshSec,
    );
    const ampsChanged =
      previousAmps === null ||
      Math.abs(targetAmps - previousAmps) >= input.deadbandAmps;
    const allowCommands = input.controlMode === 'ACTIVE';
    const shouldSendCommand =
      allowCommands &&
      (ampsChanged ||
        refreshWindowExpired ||
        member.lastAppliedDecisionHash == null);
    const commandType: EnergyAllocationCommandType =
      targetAmps > 0 ? 'ApplyChargingLimit' : 'ClearChargingLimit';

    return {
      chargePointId: member.chargePointId,
      enabled: member.enabled,
      priority: member.priority,
      smartChargingEnabled: member.smartChargingEnabled,
      previousAmps,
      targetAmps:
        input.controlMode === 'DISABLED'
          ? 0
          : Math.max(0, Math.floor(targetAmps)),
      commandType:
        member.smartChargingEnabled && member.enabled ? commandType : 'None',
      shouldSendCommand:
        member.smartChargingEnabled &&
        member.enabled &&
        shouldSendCommand &&
        input.controlMode !== 'DISABLED',
      reasonCode: member.smartChargingEnabled
        ? member.enabled
          ? input.controlMode === 'DISABLED'
            ? 'GROUP_DISABLED'
            : ampsChanged
              ? 'LIMIT_CHANGED'
              : refreshWindowExpired
                ? 'COMMAND_REFRESH'
                : 'UNCHANGED'
          : 'MEMBERSHIP_DISABLED'
        : 'CHARGER_EXCLUDED',
    };
  });
}

function allocateEqual(
  members: EnergyAllocationMemberInput[],
  effectiveLimitAmps: number,
): number[] {
  if (members.length === 0 || effectiveLimitAmps <= 0) {
    return members.map(() => 0);
  }

  return distributeEvenlyWithCaps(members, effectiveLimitAmps);
}

function allocatePriority(
  members: EnergyAllocationMemberInput[],
  effectiveLimitAmps: number,
): number[] {
  if (members.length === 0 || effectiveLimitAmps <= 0) {
    return members.map(() => 0);
  }

  const targets = new Array<number>(members.length).fill(0);
  let remaining = effectiveLimitAmps;
  let cursor = 0;

  while (cursor < members.length && remaining > 0) {
    const priority = members[cursor].priority;
    const band: Array<{ member: EnergyAllocationMemberInput; index: number }> =
      [];
    while (cursor < members.length && members[cursor].priority === priority) {
      band.push({ member: members[cursor], index: cursor });
      cursor += 1;
    }

    const bandTargets = distributeEvenlyWithCaps(
      band.map(({ member }) => member),
      remaining,
    );
    bandTargets.forEach((assigned, bandIndex) => {
      targets[band[bandIndex].index] = assigned;
      remaining -= assigned;
    });
  }

  return targets;
}

function distributeEvenlyWithCaps(
  members: EnergyAllocationMemberInput[],
  capacity: number,
): number[] {
  const targets = new Array<number>(members.length).fill(0);
  let remaining = Math.max(0, Math.floor(capacity));
  let eligible = members.map((_, index) => index);

  while (remaining > 0 && eligible.length > 0) {
    const share = Math.floor(remaining / eligible.length);
    const remainder = remaining % eligible.length;
    let assigned = 0;
    const nextEligible: number[] = [];

    eligible.forEach((index, position) => {
      const member = members[index];
      const cap = normalizeOptionalInt(member.maxAmps);
      const desired = targets[index] + share + (position < remainder ? 1 : 0);
      const capped = cap === null ? desired : Math.min(desired, cap);
      const delta = capped - targets[index];
      targets[index] = capped;
      assigned += delta;

      if (cap === null || targets[index] < cap) {
        nextEligible.push(index);
      }
    });

    if (assigned <= 0) {
      break;
    }

    remaining -= assigned;
    eligible = nextEligible;
  }

  return targets;
}

function clampToMemberLimit(value: number, maxAmps?: number | null): number {
  const normalizedValue = Math.max(0, Math.floor(value));
  const normalizedMax = normalizeOptionalInt(maxAmps);
  if (normalizedMax === null) return normalizedValue;
  return Math.min(normalizedValue, normalizedMax);
}

function normalizePhaseTriple(
  value: Partial<PhaseTriple> | undefined,
): PhaseTriple {
  return {
    phase1: normalizeOptionalInt(value?.phase1) ?? 0,
    phase2: normalizeOptionalInt(value?.phase2) ?? 0,
    phase3: normalizeOptionalInt(value?.phase3) ?? 0,
  };
}

function clampPhaseTriple(value: PhaseTriple): PhaseTriple {
  return {
    phase1: Math.max(0, Math.floor(value.phase1)),
    phase2: Math.max(0, Math.floor(value.phase2)),
    phase3: Math.max(0, Math.floor(value.phase3)),
  };
}

function subtractPhaseTriple(
  left: PhaseTriple,
  right: PhaseTriple,
): PhaseTriple {
  return {
    phase1: Math.max(0, left.phase1 - right.phase1),
    phase2: Math.max(0, left.phase2 - right.phase2),
    phase3: Math.max(0, left.phase3 - right.phase3),
  };
}

function minPhaseTriple(left: PhaseTriple, right: PhaseTriple): PhaseTriple {
  return {
    phase1: Math.min(left.phase1, right.phase1),
    phase2: Math.min(left.phase2, right.phase2),
    phase3: Math.min(left.phase3, right.phase3),
  };
}

function resolveScalarLimit(value: PhaseTriple): number {
  const positivePhases = [value.phase1, value.phase2, value.phase3].filter(
    (phase) => phase > 0,
  );
  if (positivePhases.length === 0) return 0;
  return Math.min(...positivePhases);
}

function normalizeOptionalInt(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function resolveTelemetryAgeSec(
  nowIso: string,
  sampledAt?: string | null,
  freshnessSec?: number | null,
): number | null {
  const normalizedFreshness = normalizeOptionalInt(freshnessSec);
  if (normalizedFreshness !== null) {
    return normalizedFreshness;
  }

  if (!sampledAt) return null;
  const now = Date.parse(nowIso);
  const sampled = Date.parse(sampledAt);
  if (!Number.isFinite(now) || !Number.isFinite(sampled)) {
    return null;
  }
  return Math.max(0, Math.floor((now - sampled) / 1000));
}

function resolveOverrideCap(
  override: EnergyOverrideState | null | undefined,
  nowIso: string,
): number | null {
  if (!override || !override.active) return null;
  if (override.expiresAt) {
    const expiresAt = Date.parse(override.expiresAt);
    const now = Date.parse(nowIso);
    if (
      Number.isFinite(expiresAt) &&
      Number.isFinite(now) &&
      expiresAt <= now
    ) {
      return null;
    }
  }
  return normalizeOptionalInt(override.capAmps ?? null);
}

function hasRefreshWindowExpired(
  lastCommandAt: string | null | undefined,
  nowIso: string,
  commandRefreshSec: number,
): boolean {
  if (!lastCommandAt) return true;
  const lastCommandMs = Date.parse(lastCommandAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(lastCommandMs) || !Number.isFinite(nowMs)) {
    return true;
  }
  return (
    nowMs - lastCommandMs >= Math.max(1, Math.floor(commandRefreshSec)) * 1000
  );
}

function deriveReasonCode(input: {
  controlMode: EnergyControlMode;
  isTelemetryFailSafe: boolean;
  isTelemetryStale: boolean;
  overrideCapAmps: number | null;
  activeMembers: EnergyAllocationMemberInput[];
  excludedCount: number;
}): string {
  if (input.controlMode === 'DISABLED') return 'GROUP_DISABLED';
  if (input.isTelemetryFailSafe) return 'FAIL_SAFE_LIMIT';
  if (input.overrideCapAmps !== null) return 'MANUAL_OVERRIDE';
  if (input.isTelemetryStale) return 'STALE_TELEMETRY';
  if (input.activeMembers.length === 0) return 'NO_ACTIVE_CHARGERS';
  if (input.excludedCount > 0) return 'CHARGER_EXCLUDED';
  return 'NORMAL_OPERATION';
}
