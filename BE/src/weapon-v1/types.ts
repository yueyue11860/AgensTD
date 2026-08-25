import type { GeneralArchetype } from '../core/hero-v1/types'

export type WeaponQuality = 'green' | 'blue' | 'purple' | 'orange' | 'red'
export type WeaponFragmentRequirement = 1 | 2 | 3 | 4 | 5

export const WEAPON_FRAGMENT_REQUIREMENT: Readonly<Record<WeaponQuality, WeaponFragmentRequirement>> = {
  green: 1,
  blue: 2,
  purple: 3,
  orange: 4,
  red: 5,
}

export type WeaponStat =
  | 'attack'
  | 'attack_speed'
  | 'attack_range'
  | 'magic_damage'
  | 'cooldown_reduction'
  | 'summon_attack'
  | 'summon_attack_speed'
  | 'summon_attack_range'
  | 'summon_crit_rate'
  | 'summon_crit_damage'
  | 'summon_damage'
  | 'summon_duration'
  | 'summon_alive_limit'
  | 'control_duration'
  | 'controlled_target_damage'
  | 'boss_damage'
  | 'crit_damage'
  | 'dot_duration'
  | 'zone_duration'
  | 'direct_skill_damage'

export interface WeaponStatModifier {
  effectId: string
  target: 'owner_general' | 'owned_summons'
  stat: WeaponStat
  operation: 'add_flat' | 'add_ratio'
  /** add_ratio 使用基点，10000 = 100%；距离平值使用 milli-cell。 */
  value: number
  conditionTagsAny?: readonly string[]
}

export type WeaponTriggerKind =
  | 'on_basic_attack_hit'
  | 'on_nth_basic_attack'
  | 'on_active_skill_cast'
  | 'on_active_skill_hit'
  | 'on_displacement_success'
  | 'on_status_applied'
  | 'on_summon_basic_attack'
  | 'on_summoned_enemy_killed'
  | 'on_enemy_killed'

export interface WeaponTriggerDefinition {
  triggerId: string
  kind: WeaponTriggerKind
  chanceBps?: number
  perTargetIcdMs?: number
  maxTriggersPerSecond?: number
  n?: number
  counterScope?: 'owner_general' | 'each_summon'
  maxTriggersPerCast?: number
  maxTargetsPerCast?: number
  statusTags?: readonly string[]
  summonUnitFilter?: readonly string[]
  maxTriggersPerPeriod?: number
  periodMs?: number
  maxTriggersPerSkillCycle?: number
  actions: readonly WeaponTriggerAction[]
}

export type WeaponTriggerAction =
  | { type: 'apply_status', statusId: string, magnitudeBps: number, durationMs: number }
  | { type: 'extra_damage', damageType: 'physical' | 'magic', coefficientBps: number }
  | { type: 'spawn_zone', zoneId: string, radiusMilliCells: number, durationMs: number, tickIntervalMs: number, coefficientBpsPerTick: number, maxOwned: number }
  | { type: 'path_displacement', distanceMilliCells: number, bossRatioBps: number, toward: 'primary' | 'backward' }
  | { type: 'cooldown_modify', scope: 'owner_active' | 'owner_all_generals_active', valueMs: number, minimumRemainingMs: number }
  | { type: 'propagate_status', statusId: string, targetLimit: number, durationRatioBps: number }
  | { type: 'extra_hit', coefficientBps: number, delayMs: number, targetMode: 'same' | 'return_path' | 'line' }

export interface WeaponEffectParameterPatch {
  patchId: string
  target: 'owner_general_effect' | 'owned_summon_effect'
  targetEffectId: string
  parameter: string
  operation: 'add_flat' | 'add_ratio' | 'multiply'
  value: number
  condition?: Readonly<Record<string, string | number | boolean>>
}

export interface WeaponEventBudget {
  maxExtraDamageEventsPerSecond: number
  maxExtraTargetsPerCast: number
  maxOwnedZones: number
  maxExtraSummons: number
}

export interface WeaponDefinition {
  schemaVersion: 1
  weaponId: string
  name: string
  quality: WeaponQuality
  fragmentRequirement: WeaponFragmentRequirement
  compatibility: {
    allowedArchetypes?: readonly GeneralArchetype[]
    allowedGeneralIds?: readonly string[]
    excludedGeneralIds?: readonly string[]
    exclusiveGeneralId?: string
  }
  uniqueGroup?: string
  statModifiers: readonly WeaponStatModifier[]
  triggers: readonly WeaponTriggerDefinition[]
  parameterPatches: readonly WeaponEffectParameterPatch[]
  eventBudget: WeaponEventBudget
  ui: {
    shortDescription: string
    detailDescription: string
    iconKey: string
  }
  status: 'prototype' | 'testing' | 'released'
}

export interface GeneralWeaponLoadoutState {
  slots: [string | null, string | null]
  version: number
  updatedAt: string
}

export interface PlayerWeaponAccount {
  playerId: string
  fragmentBalances: Record<string, number>
  unlockedWeaponIds: string[]
  loadoutsByGeneralId: Record<string, GeneralWeaponLoadoutState>
  version: number
}

export interface MatchWeaponLoadoutSnapshot {
  snapshotVersion: 1
  playerId: string
  accountVersion: number
  byGeneralId: Readonly<Record<string, {
    slots: readonly [string | null, string | null]
    resolvedDefinitions: readonly WeaponDefinition[]
  }>>
}

export interface WeaponProjectionSource {
  sourceKey: string
  slotIndex: 0 | 1
  weaponId: string
  generalId: string
  statModifiers: readonly WeaponStatModifier[]
  triggers: readonly WeaponTriggerDefinition[]
  parameterPatches: readonly WeaponEffectParameterPatch[]
  resolvedEffects: readonly (
    | { kind: 'stat_modifier', sourceKey: string, definition: WeaponStatModifier }
    | { kind: 'trigger', sourceKey: string, definition: WeaponTriggerDefinition }
    | { kind: 'parameter_patch', sourceKey: string, definition: WeaponEffectParameterPatch }
  )[]
  eventBudget: WeaponEventBudget
}

export type WeaponErrorCode =
  | 'WEAPON_NOT_FOUND'
  | 'WEAPON_NOT_UNLOCKED'
  | 'WEAPON_ALREADY_UNLOCKED'
  | 'INSUFFICIENT_FRAGMENTS'
  | 'WEAPON_INCOMPATIBLE'
  | 'EXCLUSIVE_GENERAL_MISMATCH'
  | 'DUPLICATE_WEAPON_IN_LOADOUT'
  | 'UNIQUE_GROUP_CONFLICT'
  | 'STALE_WEAPON_ACCOUNT_VERSION'
  | 'STALE_WEAPON_LOADOUT_VERSION'
  | 'REQUEST_ID_CONFLICT'
  | 'INVALID_FRAGMENT_AMOUNT'
  | 'INVALID_PURCHASE_ENTITLEMENT'
  | 'INSUFFICIENT_GOLD'
  | 'OFFER_NOT_FOUND'

export class WeaponDomainError extends Error {
  constructor(readonly code: WeaponErrorCode, message: string) {
    super(message)
    this.name = 'WeaponDomainError'
  }
}
