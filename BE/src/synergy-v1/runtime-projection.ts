import type {
  GeneralFacetDimension,
  GeneralSynergyProfile,
  SynergyEffect,
  SynergyEffectParameterPatch,
  SynergyReconcileCommand,
  SynergyStat,
  SynergyStatModifierEffect,
} from './types'

export type SynergyRuntimeSubject =
  | {
      kind: 'general'
      ownerPlayerId: string
      generalId: string
    }
  | {
      kind: 'summon'
      ownerPlayerId: string
      /** 召唤物的归属神将，而不是召唤物模板 id。 */
      sourceGeneralId: string
      summonUnitId?: string
    }
  | {
      kind: 'player'
      ownerPlayerId: string
    }

export interface SynergyRuntimeQuery {
  subject: SynergyRuntimeSubject
  /** 当前受击目标的标签，例如 normal / boss / yao / mo。 */
  targetTags?: readonly string[]
  /** 当前被修改的技能效果标签，例如 active_skill。 */
  effectTags?: readonly string[]
  /** 查询参数补丁时传入具体的 effectId；缺省时返回该主体的全部补丁。 */
  targetEffectId?: string
}

export interface RuntimeSynergyEffectSource {
  sourceKind: 'synergy'
  sourceId: string
  ownerPlayerId: string
  activationLevel: number
  contributingGeneralIds: readonly string[]
}

export interface RuntimeSynergyStatModifier extends RuntimeSynergyEffectSource {
  effectId: string
  type: 'stat_modifier'
  stat: SynergyStat
  operation: SynergyStatModifierEffect['operation']
  value: number
  stackGroup: string
}

export interface RuntimeSynergyParameterPatch extends RuntimeSynergyEffectSource {
  effectId: string
  type: 'effect_parameter_patch'
  targetEffectId: string
  parameter: string
  operation: SynergyEffectParameterPatch['operation']
  value: number
  stackGroup: string
}

export type RuntimeSynergyQueryExclusionReason =
  | 'target_scope_mismatch'
  | 'target_condition_mismatch'
  | 'effect_condition_mismatch'
  | 'target_effect_mismatch'

export interface SynergyRuntimeQueryResult {
  statModifiers: RuntimeSynergyStatModifier[]
  parameterPatches: RuntimeSynergyParameterPatch[]
  /**
   * 当前玩家已激活但未匹配本次查询的效果。保留原因便于调试，
   * 避免条件、target 或 effectId 错配时被静默吞掉。
   */
  excluded: Array<{
    sourceId: string
    effect: SynergyEffect
    reason: RuntimeSynergyQueryExclusionReason
  }>
}

interface StoredSynergySource {
  source: RuntimeSynergyEffectSource
  effects: readonly SynergyEffect[]
}

export interface SynergySourceRegistryApplyResult {
  appliedSourceIds: string[]
  removedSourceIds: string[]
  appliedEffectCount: number
}

function profileValues(
  profile: GeneralSynergyProfile,
  dimension: GeneralFacetDimension,
): readonly string[] {
  switch (dimension) {
    case 'faction': return profile.factions
    case 'profession': return [profile.profession]
    case 'playstyle': return profile.playstyles
    case 'named_collection': return profile.namedCollections
  }
}

function intersects(required: readonly string[] | undefined, actual: readonly string[] | undefined): boolean {
  if (!required || required.length === 0) return true
  if (!actual || actual.length === 0) return false
  const actualSet = new Set(actual)
  return required.some((tag) => actualSet.has(tag))
}

function sourceRegistryKey(ownerPlayerId: string, sourceId: string): string {
  return `${ownerPlayerId}\u0000${sourceId}`
}

/**
 * 统一羁绊运行时源注册表。
 *
 * - apply_effects 以 (ownerPlayerId, sourceId) 为原子替换单位，不叠加旧档位。
 * - remove_source 只删除精确玩家的精确羁绊源，不会伤及其他玩家或其他羁绊。
 * - 注册时保留所有合法 SynergyEffect，查询时再按主体、facet 和条件投影。
 */
export class SynergyRuntimeProjectionRegistry {
  private readonly profilesById: ReadonlyMap<string, GeneralSynergyProfile>
  private readonly sources = new Map<string, StoredSynergySource>()

  constructor(profiles: readonly GeneralSynergyProfile[]) {
    const byId = new Map<string, GeneralSynergyProfile>()
    for (const profile of profiles) {
      if (byId.has(profile.generalId)) {
        throw new Error(`Duplicate synergy runtime profile: ${profile.generalId}`)
      }
      byId.set(profile.generalId, profile)
    }
    this.profilesById = byId
  }

  applyReconcileCommands(input: {
    ownerPlayerId: string
    commands: readonly SynergyReconcileCommand[]
  }): SynergySourceRegistryApplyResult {
    const appliedSourceIds: string[] = []
    const removedSourceIds: string[] = []
    let appliedEffectCount = 0

    for (const command of input.commands) {
      if (command.sourceKind !== 'synergy') {
        throw new Error(`Unsupported source kind: ${String(command.sourceKind)}`)
      }
      const key = sourceRegistryKey(input.ownerPlayerId, command.sourceId)
      if (command.kind === 'remove_source') {
        if (this.sources.delete(key)) removedSourceIds.push(command.sourceId)
        continue
      }

      const contributorIds = [...new Set(command.contributingGeneralIds)].sort()
      for (const generalId of contributorIds) {
        if (!this.profilesById.has(generalId)) {
          throw new Error(`Unknown contributing general ${generalId} in runtime source ${command.sourceId}`)
        }
      }
      const effectIds = new Set<string>()
      for (const effect of command.effects) {
        if (effectIds.has(effect.effectId)) {
          throw new Error(`Duplicate effect ${effect.effectId} in runtime source ${command.sourceId}`)
        }
        effectIds.add(effect.effectId)
      }
      // 上面校验全部成功后再替换，保证单源原子性。
      this.sources.set(key, {
        source: {
          sourceKind: 'synergy',
          sourceId: command.sourceId,
          ownerPlayerId: input.ownerPlayerId,
          activationLevel: command.activationLevel,
          contributingGeneralIds: contributorIds,
        },
        effects: [...command.effects],
      })
      appliedSourceIds.push(command.sourceId)
      appliedEffectCount += command.effects.length
    }

    return { appliedSourceIds, removedSourceIds, appliedEffectCount }
  }

  removePlayer(ownerPlayerId: string): number {
    let removed = 0
    for (const [key, source] of this.sources) {
      if (source.source.ownerPlayerId !== ownerPlayerId) continue
      this.sources.delete(key)
      removed += 1
    }
    return removed
  }

  query(query: SynergyRuntimeQuery): SynergyRuntimeQueryResult {
    const result: SynergyRuntimeQueryResult = {
      statModifiers: [],
      parameterPatches: [],
      excluded: [],
    }
    const candidates = [...this.sources.values()]
      .filter((stored) => stored.source.ownerPlayerId === query.subject.ownerPlayerId)
      .sort((left, right) => left.source.sourceId.localeCompare(right.source.sourceId))

    for (const stored of candidates) {
      for (const effect of stored.effects) {
        const targetMatches = this.targetMatches(effect, stored.source, query.subject)
        if (!targetMatches) {
          result.excluded.push({
            sourceId: stored.source.sourceId,
            effect,
            reason: 'target_scope_mismatch',
          })
          continue
        }
        if (effect.type === 'stat_modifier') {
          if (!intersects(effect.condition?.targetTagsAny, query.targetTags)) {
            result.excluded.push({ sourceId: stored.source.sourceId, effect, reason: 'target_condition_mismatch' })
            continue
          }
          if (!intersects(effect.condition?.effectTagsAny, query.effectTags)) {
            result.excluded.push({ sourceId: stored.source.sourceId, effect, reason: 'effect_condition_mismatch' })
            continue
          }
          result.statModifiers.push({
            ...stored.source,
            effectId: effect.effectId,
            type: effect.type,
            stat: effect.stat,
            operation: effect.operation,
            value: effect.value,
            stackGroup: effect.stackGroup,
          })
          continue
        }
        if (query.targetEffectId && effect.targetEffectId !== query.targetEffectId) {
          result.excluded.push({ sourceId: stored.source.sourceId, effect, reason: 'target_effect_mismatch' })
          continue
        }
        result.parameterPatches.push({
          ...stored.source,
          effectId: effect.effectId,
          type: effect.type,
          targetEffectId: effect.targetEffectId,
          parameter: effect.parameter,
          operation: effect.operation,
          value: effect.value,
          stackGroup: effect.stackGroup,
        })
      }
    }

    result.statModifiers.sort(compareRuntimeEffect)
    result.parameterPatches.sort(compareRuntimeEffect)
    return result
  }

  activeSources(ownerPlayerId?: string): RuntimeSynergyEffectSource[] {
    return [...this.sources.values()]
      .filter((stored) => ownerPlayerId === undefined || stored.source.ownerPlayerId === ownerPlayerId)
      .map((stored) => ({ ...stored.source }))
      .sort((left, right) => left.ownerPlayerId.localeCompare(right.ownerPlayerId)
        || left.sourceId.localeCompare(right.sourceId))
  }

  private targetMatches(
    effect: SynergyEffect,
    source: RuntimeSynergyEffectSource,
    subject: SynergyRuntimeSubject,
  ): boolean {
    switch (effect.target.scope) {
      case 'synergy_members':
        return subject.kind === 'general'
          && source.contributingGeneralIds.includes(subject.generalId)
      case 'owner_generals_with_facet': {
        if (subject.kind !== 'general') return false
        const profile = this.profilesById.get(subject.generalId)
        return Boolean(profile && profileValues(profile, effect.target.dimension).includes(effect.target.facetId))
      }
      case 'owned_summons_of_synergy_members':
        return subject.kind === 'summon'
          && source.contributingGeneralIds.includes(subject.sourceGeneralId)
      case 'owner_player':
        return subject.kind === 'player'
    }
  }
}

function compareRuntimeEffect(
  left: RuntimeSynergyStatModifier | RuntimeSynergyParameterPatch,
  right: RuntimeSynergyStatModifier | RuntimeSynergyParameterPatch,
): number {
  return left.sourceId.localeCompare(right.sourceId) || left.effectId.localeCompare(right.effectId)
}

/** 按统一操作顺序结算单项属性，支持 SynergyModifierOperation 全集。 */
export function settleRuntimeSynergyStat(input: {
  baseValue: number
  stat: SynergyStat
  modifiers: readonly RuntimeSynergyStatModifier[]
}): number {
  let addFlat = 0
  let addRatio = 0
  let multiplier = 1
  let lowerBound = Number.NEGATIVE_INFINITY
  let upperBound = Number.POSITIVE_INFINITY
  for (const modifier of input.modifiers) {
    if (modifier.stat !== input.stat) continue
    switch (modifier.operation) {
      case 'add_flat': addFlat += modifier.value; break
      case 'add_ratio': addRatio += modifier.value; break
      case 'multiply': multiplier *= modifier.value; break
      case 'min': upperBound = Math.min(upperBound, modifier.value); break
      case 'max': lowerBound = Math.max(lowerBound, modifier.value); break
    }
  }
  return Math.min(
    upperBound,
    Math.max(lowerBound, (input.baseValue + addFlat) * (10000 + addRatio) / 10000 * multiplier),
  )
}

/**
 * 结算某个具名技能参数。add_ratio 使用基点，multiply 使用直接倍率；
 * 同层先汇总 add_flat/add_ratio，再乘以全部 multiply，从而不依赖 catalog 顺序。
 */
export function settleRuntimeSynergyParameter(input: {
  baseValue: number
  parameter: string
  patches: readonly RuntimeSynergyParameterPatch[]
}): number {
  let addFlat = 0
  let addRatio = 0
  let multiplier = 1
  for (const patch of input.patches) {
    if (patch.parameter !== input.parameter) continue
    switch (patch.operation) {
      case 'add_flat': addFlat += patch.value; break
      case 'add_ratio': addRatio += patch.value; break
      case 'multiply': multiplier *= patch.value; break
    }
  }
  return (input.baseValue + addFlat) * (10000 + addRatio) / 10000 * multiplier
}
