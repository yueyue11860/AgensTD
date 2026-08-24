export type GeneralProfession = 'physical' | 'magic' | 'summon' | 'control'

export type GeneralFacetDimension =
  | 'faction'
  | 'profession'
  | 'playstyle'
  | 'named_collection'

export interface GeneralSynergyProfile {
  generalId: string
  displayName: string
  glyphs: readonly string[]
  factions: readonly string[]
  profession: GeneralProfession
  playstyles: readonly string[]
  namedCollections: readonly string[]
}

export type GeneralRuntimeZone = 'board' | 'tray' | 'reserve' | 'discard'

/**
 * 由神将组合器投影给羁绊系统的最小状态。
 * 羁绊系统不自己重新识别汉字坐标，避免出现第二套组合规则。
 */
export interface GeneralFormationProjection {
  ownerPlayerId: string
  generalId: string
  zone: GeneralRuntimeZone
  isFormed: boolean
  isFixed: boolean
  constituentTokenIds: readonly string[]
}

export type SynergyRequirement =
  | {
      kind: 'all_generals'
      generalIds: readonly string[]
    }
  | {
      kind: 'facet_count'
      dimension: GeneralFacetDimension
      facetId: string
      minimum: number
    }

export type SynergyEffectTarget =
  | {
      scope: 'synergy_members'
    }
  | {
      scope: 'owner_generals_with_facet'
      dimension: GeneralFacetDimension
      facetId: string
    }
  | {
      scope: 'owned_summons_of_synergy_members'
    }

export type SynergyStat =
  | 'attack'
  | 'attackSpeed'
  | 'attackRange'
  | 'critRate'
  | 'critDamage'
  | 'physicalDamageBonus'
  | 'magicDamageBonus'
  | 'cooldownReduction'
  | 'controlDuration'
  | 'summonAttack'
  | 'summonAttackSpeed'

export type SynergyModifierOperation =
  | 'add_flat'
  | 'add_ratio'
  | 'multiply'
  | 'min'
  | 'max'

export interface SynergyStatModifierEffect {
  effectId: string
  type: 'stat_modifier'
  target: SynergyEffectTarget
  stat: SynergyStat
  operation: SynergyModifierOperation
  /** add_ratio 使用基点（10000=100%）；add_flat 使用属性自身整数单位（射程为 milli-cells）。 */
  value: number
  stackGroup: string
}

export interface SynergyEffectParameterPatch {
  effectId: string
  type: 'effect_parameter_patch'
  target: SynergyEffectTarget
  targetEffectId: string
  parameter: string
  operation: 'add_flat' | 'add_ratio' | 'multiply'
  value: number
  stackGroup: string
}

export type SynergyEffect = SynergyStatModifierEffect | SynergyEffectParameterPatch

export type SynergyCategory =
  | 'faction'
  | 'profession'
  | 'playstyle'
  | 'named_collection'
  | 'specific_combination'

export interface SynergyActivationLevel {
  level: number
  requirements: readonly SynergyRequirement[]
  effects: readonly SynergyEffect[]
}

export interface SynergyDefinition {
  schemaVersion: 1
  synergyId: string
  displayName: string
  category: SynergyCategory
  activationScope: 'owner_board_formed_generals'
  levels: readonly SynergyActivationLevel[]
  status: 'prototype' | 'balance_test' | 'final'
}

export interface ActiveSynergyState {
  synergyId: string
  level: number
  contributingGeneralIds: readonly string[]
}

export interface PlayerSynergyEvaluation {
  ownerPlayerId: string
  activeGeneralIds: readonly string[]
  activeSynergies: readonly ActiveSynergyState[]
}

export type SynergyReconcileCommand =
  | {
      kind: 'remove_source'
      sourceKind: 'synergy'
      sourceId: string
    }
  | {
      kind: 'apply_effects'
      sourceKind: 'synergy'
      sourceId: string
      activationLevel: number
      contributingGeneralIds: readonly string[]
      effects: readonly SynergyEffect[]
    }

export interface SynergyReconcileResult {
  next: PlayerSynergyEvaluation
  activated: readonly ActiveSynergyState[]
  deactivated: readonly ActiveSynergyState[]
  changedLevels: readonly {
    previous: ActiveSynergyState
    next: ActiveSynergyState
  }[]
  commands: readonly SynergyReconcileCommand[]
  invalidateGeneralIds: readonly string[]
  refreshSummonsOwnedByGeneralIds: readonly string[]
}
