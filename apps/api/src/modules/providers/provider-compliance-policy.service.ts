import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma.service'

export type ProviderCompliancePolicyData = {
  effectiveDateMode: 'WARN_BEFORE_ENFORCE' | 'ENFORCE_NOW'
  roadmapAllowedBeforeEffective: boolean
  markets: Array<'CN' | 'HK' | 'FI'>
  hk: {
    dg: {
      requireConfig: boolean
      thresholdKwh: number | null
      class9aLabel?: string
    }
  }
}

const PROVIDER_POLICY_CODE = 'PROVIDER_COMPLIANCE_V2'

const DEFAULT_POLICY: ProviderCompliancePolicyData = {
  effectiveDateMode: 'WARN_BEFORE_ENFORCE',
  roadmapAllowedBeforeEffective: true,
  markets: ['CN', 'HK', 'FI'],
  hk: {
    dg: {
      requireConfig: true,
      thresholdKwh: null,
      class9aLabel: 'DG_CLASS_9A',
    },
  },
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

@Injectable()
export class ProviderCompliancePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  getDefaultPolicy(): ProviderCompliancePolicyData {
    return DEFAULT_POLICY
  }

  normalizePolicy(data: unknown): ProviderCompliancePolicyData {
    const root = asObject(data)
    const hk = asObject(root.hk)
    const dg = asObject(hk.dg)

    const effectiveDateMode = root.effectiveDateMode === 'ENFORCE_NOW' ? 'ENFORCE_NOW' : 'WARN_BEFORE_ENFORCE'
    const roadmapAllowedBeforeEffective = root.roadmapAllowedBeforeEffective !== false

    const marketsRaw = Array.isArray(root.markets) ? root.markets.map((item) => String(item).toUpperCase()) : DEFAULT_POLICY.markets
    const markets = marketsRaw.filter((item): item is 'CN' | 'HK' | 'FI' => item === 'CN' || item === 'HK' || item === 'FI')

    const thresholdRaw = dg.thresholdKwh
    const thresholdKwh = typeof thresholdRaw === 'number' && Number.isFinite(thresholdRaw) ? thresholdRaw : null

    return {
      effectiveDateMode,
      roadmapAllowedBeforeEffective,
      markets: markets.length > 0 ? markets : DEFAULT_POLICY.markets,
      hk: {
        dg: {
          requireConfig: dg.requireConfig !== false,
          thresholdKwh,
          class9aLabel:
            typeof dg.class9aLabel === 'string' && dg.class9aLabel.trim().length > 0
              ? dg.class9aLabel.trim()
              : DEFAULT_POLICY.hk.dg.class9aLabel,
        },
      },
    }
  }

  async getProviderPolicy() {
    const existing = await this.prisma.compliancePolicy.findUnique({ where: { code: PROVIDER_POLICY_CODE } })
    if (!existing) {
      const created = await this.prisma.compliancePolicy.create({
        data: {
          code: PROVIDER_POLICY_CODE,
          data: DEFAULT_POLICY as unknown as Prisma.InputJsonValue,
        },
      })
      return { ...created, data: this.normalizePolicy(created.data) }
    }

    return {
      ...existing,
      data: this.normalizePolicy(existing.data),
    }
  }

  async updateProviderPolicy(input: Partial<ProviderCompliancePolicyData>, updatedBy?: string) {
    const current = await this.getProviderPolicy()
    const merged = this.normalizePolicy({
      ...current.data,
      ...input,
      hk: {
        ...current.data.hk,
        ...(input.hk || {}),
        dg: {
          ...current.data.hk.dg,
          ...(input.hk?.dg || {}),
        },
      },
    })

    const updated = await this.prisma.compliancePolicy.update({
      where: { code: PROVIDER_POLICY_CODE },
      data: {
        data: merged as unknown as Prisma.InputJsonValue,
        updatedBy: updatedBy || null,
      },
    })

    return {
      ...updated,
      data: this.normalizePolicy(updated.data),
    }
  }
}
