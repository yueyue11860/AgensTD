import type { GeneralStat, GeneralStatModifier } from '../core/hero-v1/types'
import type { SynergyEffect, SynergyStat } from './types'

type HeroV1SynergyStat = Extract<GeneralStat, SynergyStat>

const HERO_V1_STATS = new Set<HeroV1SynergyStat>([
  'attack',
  'attackSpeed',
  'attackRange',
  'critRate',
  'critDamage',
])

function isHeroV1Stat(stat: SynergyStat): stat is HeroV1SynergyStat {
  return HERO_V1_STATS.has(stat as HeroV1SynergyStat)
}

/**
 * 首个纵向切片的精确边界适配器。它只接受 hero-v1 已支持的成员属性修改；
 * 技能参数补丁、分类目标和召唤物目标等待统一效果执行器，不在这里静默忽略。
 */
export function toHeroV1GeneralStatModifiers(input: {
  sourceSynergyId: string
  contributingGeneralIds: readonly string[]
  effects: readonly SynergyEffect[]
}): GeneralStatModifier[] {
  const result: GeneralStatModifier[] = []
  for (const effect of input.effects) {
    if (effect.type !== 'stat_modifier') {
      throw new Error(`hero-v1 cannot apply synergy effect type ${effect.type}`)
    }
    if (effect.target.scope !== 'synergy_members') {
      throw new Error(`hero-v1 cannot apply synergy target scope ${effect.target.scope}`)
    }
    if (!isHeroV1Stat(effect.stat)) {
      throw new Error(`hero-v1 does not support synergy stat ${effect.stat}`)
    }
    if (effect.operation !== 'add_flat' && effect.operation !== 'add_ratio') {
      throw new Error(`hero-v1 does not support modifier operation ${effect.operation}`)
    }

    result.push({
      source: { kind: 'synergy', sourceId: input.sourceSynergyId },
      target: {
        scope: 'synergy_members',
        generalIds: [...input.contributingGeneralIds],
      },
      stat: effect.stat,
      operation: effect.operation,
      value: effect.value,
      stackGroup: effect.stackGroup,
    })
  }
  return result
}
