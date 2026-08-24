import type { SynergyModifierOperation, SynergyStat } from './types'

export const SYNERGY_GLOBAL_LIMITS = {
  cooldownReductionMaxBps: 4000,
  skillCooldownMinMs: 1000,
  attackSpeedMaxPerSecond: 5,
  critRateMin: 0,
  critRateMax: 1,
} as const

export interface NumericModifier {
  sourceKind: 'synergy'
  sourceId: string
  stat: SynergyStat
  operation: SynergyModifierOperation
  value: number
}

export function settleNumericStat(baseValue: number, modifiers: readonly NumericModifier[]): number {
  let addFlat = 0
  let addRatio = 0
  let multiplier = 1
  let lowerBound = Number.NEGATIVE_INFINITY
  let upperBound = Number.POSITIVE_INFINITY

  for (const modifier of modifiers) {
    switch (modifier.operation) {
      case 'add_flat':
        addFlat += modifier.value
        break
      case 'add_ratio':
        addRatio += modifier.value
        break
      case 'multiply':
        multiplier *= modifier.value
        break
      case 'min':
        upperBound = Math.min(upperBound, modifier.value)
        break
      case 'max':
        lowerBound = Math.max(lowerBound, modifier.value)
        break
    }
  }

  return Math.min(
    upperBound,
    Math.max(lowerBound, (baseValue + addFlat) * (10000 + addRatio) / 10000 * multiplier),
  )
}

export function settleSkillCooldownMs(input: {
  baseCooldownMs: number
  reductionBps: readonly number[]
  flatReductionMs?: number
}): number {
  const reductionBps = Math.min(
    SYNERGY_GLOBAL_LIMITS.cooldownReductionMaxBps,
    Math.max(0, input.reductionBps.reduce((sum, value) => sum + value, 0)),
  )
  const reduced = input.baseCooldownMs * (10000 - reductionBps) / 10000
    - (input.flatReductionMs ?? 0)
  return Math.max(SYNERGY_GLOBAL_LIMITS.skillCooldownMinMs, Math.round(reduced))
}

export interface SummonInheritanceEntry {
  ownerStat: SynergyStat
  summonStat: SynergyStat
  ratio: number
}

/**
 * 召唤物只复制明示白名单属性。成员羁绊的 target 不会自动变成 owned_summons。
 */
export function inheritSummonStats(input: {
  summonBaseStats: Readonly<Partial<Record<SynergyStat, number>>>
  ownerFinalStats: Readonly<Partial<Record<SynergyStat, number>>>
  inheritance: readonly SummonInheritanceEntry[]
}): Partial<Record<SynergyStat, number>> {
  const result: Partial<Record<SynergyStat, number>> = { ...input.summonBaseStats }
  for (const entry of input.inheritance) {
    const ownerValue = input.ownerFinalStats[entry.ownerStat]
    if (ownerValue === undefined) continue
    result[entry.summonStat] = ownerValue * entry.ratio
  }
  return result
}
