export type GeneralLevel = 1 | 2 | 3 | 4 | 5

export type GeneralArchetype = 'physical' | 'magic' | 'summon' | 'control'

export type GeneralQuality = 'purple' | 'orange' | 'red'

export type LevelCurve = readonly [number, number, number, number, number]

export type GeneralTargetPriority =
  | 'furthest_progress'
  | 'highest_current_hp'
  | 'lowest_current_hp'
  | 'nearest_to_caster'

export interface GeneralSingleTargeting {
  kind?: 'single'
  scope: 'enemies_in_radius' | 'enemies_in_attack_range'
  priority: GeneralTargetPriority
  targetLimit: 1
}

export interface GeneralRadiusAoeTargeting {
  kind: 'radius_aoe'
  scope: 'enemies_around_primary'
  priority: GeneralTargetPriority
  primarySearch: 'attack_range' | 'global'
  radiusMilliCellsByLevel: LevelCurve
  targetLimit: number
}

export interface GeneralLineTargeting {
  kind: 'line'
  scope: 'enemies_in_line_from_caster'
  priority: GeneralTargetPriority
  primarySearch: 'attack_range' | 'line_length'
  lengthMilliCellsByLevel: LevelCurve
  halfWidthMilliCellsByLevel: LevelCurve
  targetLimit: number
}

export interface GeneralGlobalTargeting {
  kind: 'global'
  scope: 'all_targetable_enemies'
  priority: GeneralTargetPriority
  targetLimit: number
}

export interface GeneralChainTargeting {
  kind: 'chain'
  scope: 'chain_from_primary'
  priority: GeneralTargetPriority
  primarySearch: 'attack_range' | 'global'
  bounceRangeMilliCellsByLevel: LevelCurve
  targetLimit: number
}

export interface GeneralSelfTargeting {
  kind: 'self'
  scope: 'self'
  targetLimit: 0
}

export type GeneralAbilityTargeting =
  | GeneralSingleTargeting
  | GeneralRadiusAoeTargeting
  | GeneralLineTargeting
  | GeneralGlobalTargeting
  | GeneralChainTargeting
  | GeneralSelfTargeting

export type GeneralStat =
  | 'attack'
  | 'attackSpeed'
  | 'attackRange'
  | 'critRate'
  | 'critDamage'
  | 'damageDealt'

export interface GeneralStatModifier {
  source: {
    kind: 'passive' | 'synergy' | 'weapon' | 'passive_item' | 'stage_rule'
    sourceId: string
  }
  target: {
    scope: 'self' | 'synergy_members' | 'owner_generals'
    generalIds?: readonly string[]
  }
  stat: GeneralStat
  operation: 'add_flat' | 'add_ratio'
  /** add_ratio 使用基点（10000 = 100%）；add_flat 使用该属性自身的整数单位。 */
  value: number
  stackGroup: string
  condition?: {
    targetTagsAny?: readonly string[]
  }
}

interface GeneralEffectDefinitionBase {
  effectId: string
  targeting?: GeneralAbilityTargeting
  tags: readonly string[]
}

export interface DirectDamageEffectDefinition extends GeneralEffectDefinitionBase {
  type: 'damage'
  damageType: 'physical' | 'magic'
  coefficientBpsByLevel: LevelCurve
  flatDamageByLevel: LevelCurve
  criticalPolicy: 'can_crit' | 'cannot_crit'
  /** 未配置时每个目标只产生 1 次命中。 */
  hitCountByLevel?: LevelCurve
  hitIntervalMs?: number
  /** 保留旧版后羿配置字段；实际目标数由 targeting 决定。 */
  targetLimit?: number
}

export interface DamageOverTimeEffectDefinition extends GeneralEffectDefinitionBase {
  type: 'damage_over_time'
  damageType: 'physical' | 'magic' | 'true'
  coefficientBpsPerTickByLevel: LevelCurve
  flatDamagePerTickByLevel: LevelCurve
  tickIntervalMs: number
  durationMsByLevel: LevelCurve
  criticalPolicy: 'can_crit' | 'cannot_crit'
  stacking: GeneralEffectStacking
}

export interface GeneralEffectStacking {
  stackGroup: string
  policy: 'refresh' | 'extend' | 'stack' | 'strongest_refresh' | 'replace' | 'independent'
  maxStacks: number
}

export interface StatusApplyEffectDefinition extends GeneralEffectDefinitionBase {
  type: 'status_apply'
  statusId: string
  magnitudeByLevel: LevelCurve
  durationMsByLevel: LevelCurve
  chanceBpsByLevel: LevelCurve
  stacking: GeneralEffectStacking
}

export interface PathDisplacementEffectDefinition extends GeneralEffectDefinitionBase {
  type: 'path_displacement'
  direction: 'backward' | 'forward' | 'toward_primary'
  distanceMilliCellsByLevel: LevelCurve
  bossDistanceRatioBps: number
}

export interface SummonUnitEffectDefinition extends GeneralEffectDefinitionBase {
  type: 'summon_unit'
  summonUnitId: string
  countByLevel: LevelCurve
  durationMsByLevel: LevelCurve
  maxOwnedAliveByLevel: LevelCurve
  /** 召唤落点距锚点/路径/目标的基础半径；未配置时按 1 格处理。 */
  spawnRadiusMilliCellsByLevel?: LevelCurve
  spawnPattern:
    | 'self_surrounding_empty_cells'
    | 'path_side_nearest_empty'
    | 'target_surrounding'
    | 'owner_random_empty_board_cell'
  inheritStatRatiosBps: Readonly<Partial<Record<
    'attack' | 'attackSpeed' | 'critRate' | 'critDamage' | 'damageDealt',
    number
  >>>
  sourceInactivePolicy: 'despawn' | 'finish_duration'
}

export type GeneralZoneTickEffectDefinition =
  | DirectDamageEffectDefinition
  | DamageOverTimeEffectDefinition
  | StatusApplyEffectDefinition
  | PathDisplacementEffectDefinition

export interface SpawnZoneEffectDefinition extends GeneralEffectDefinitionBase {
  type: 'spawn_zone'
  zoneId: string
  shape:
    | { kind: 'circle', radiusMilliCellsByLevel: LevelCurve }
    | { kind: 'line', lengthMilliCellsByLevel: LevelCurve, halfWidthMilliCellsByLevel: LevelCurve }
  durationMsByLevel: LevelCurve
  tickIntervalMs: number
  tickEffects: readonly GeneralZoneTickEffectDefinition[]
  sourceInactivePolicy: 'despawn' | 'finish_duration'
}

export interface CooldownModifyEffectDefinition extends GeneralEffectDefinitionBase {
  type: 'cooldown_modify'
  targetSkill: 'active_skill' | 'basic_attack' | 'all_skills'
  operation: 'add_ms' | 'add_ratio' | 'set_ready'
  valueByLevel: LevelCurve
  maxTriggersPerCast: number
}

export interface EffectParameterPatchDefinition extends GeneralEffectDefinitionBase {
  type: 'effect_parameter_patch'
  targetEffectId: string
  parameter: string
  operation: 'add_flat' | 'add_ratio' | 'multiply'
  valueByLevel: LevelCurve
}

export type GeneralStructuredEffectDefinition =
  | DirectDamageEffectDefinition
  | DamageOverTimeEffectDefinition
  | StatusApplyEffectDefinition
  | PathDisplacementEffectDefinition
  | SummonUnitEffectDefinition
  | SpawnZoneEffectDefinition
  | CooldownModifyEffectDefinition
  | EffectParameterPatchDefinition

export type GeneralPassiveTrigger =
  | { kind: 'always' }
  | { kind: 'on_basic_attack' }
  | { kind: 'on_nth_basic_attack', every: number }
  | { kind: 'on_skill_hit' }
  | { kind: 'on_displacement_success' }
  | { kind: 'on_enemy_killed' }
  | { kind: 'periodic', intervalMsByLevel: LevelCurve, initialDelayMs?: number }

export interface GeneralDefinition<
  TActiveEffects extends readonly GeneralStructuredEffectDefinition[] = readonly GeneralStructuredEffectDefinition[],
> {
  schemaVersion: 1
  generalId: string
  name: string
  quality: GeneralQuality
  recipe: {
    glyphs: readonly string[]
    orientation: 'horizontal_left_to_right'
    priority: number
  }
  formation: {
    cellCount: number
    anchor: 'footprint_center'
    visual: 'character_tiles'
  }
  uniqueness: {
    scope: 'player'
    maxPerMatch: 1
  }
  archetype: GeneralArchetype
  factions: readonly string[]
  combatTags: readonly string[]
  levelRules: {
    initialLevel: 1
    defaultMaxLevel: GeneralLevel
    breakthroughMaxLevel: 5
    /** 依次为 1→2、2→3、3→4、4→5、5级满阶修为。 */
    experienceRequiredPoints: LevelCurve
  }
  baseStats: {
    attackByLevel: LevelCurve
    attackIntervalMsByLevel: LevelCurve
    attackRangeMilliCellsByLevel: LevelCurve
    critChanceBpsByLevel: LevelCurve
    critDamageBpsByLevel: LevelCurve
  }
  basicAttack: {
    attackId: string
    targeting: {
      scope: 'enemies_in_radius'
      priority: GeneralTargetPriority
      targetLimit: 1
    }
    effect: DirectDamageEffectDefinition
  }
  activeSkill: {
    skillId: string
    skillName: string
    trigger: 'auto'
    cooldownMsByLevel: LevelCurve
    targeting: GeneralAbilityTargeting
    effects: TActiveEffects
  }
  passiveSkill: {
    skillId: string
    skillName: string
    /** 未配置时等价于 always，保留后羿旧配置兼容。 */
    trigger?: GeneralPassiveTrigger
    effects: readonly GeneralStatModifier[]
    structuredEffects?: readonly GeneralStructuredEffectDefinition[]
  }
  /** 仅作 UI/构建反向索引；羁绊定义才是成员关系的权威来源。 */
  relatedSynergyIds: readonly string[]
}

export interface HeroCharacterToken {
  tokenId: string
  ownerPlayerId: string
  glyph: string
  x: number
  y: number
}

export interface GeneralFormationState {
  formationId: string
  ownerPlayerId: string
  generalId: string
  characterTokenIds: string[]
  cells: Array<{ x: number, y: number }>
  anchorMilli: { x: number, y: number }
  fixed: boolean
  active: true
  revision: number
}

export interface GeneralProgressState {
  progressId: string
  ownerPlayerId: string
  generalId: string
  firstActivatedAtTick: number
  experiencePoints: number
  level: GeneralLevel
  maxLevel: GeneralLevel
  fullRankExperiencePoints: number
  hasTriggeredFirstActivationReward: boolean
  nextBasicAttackTick: number
  activeSkillReadyAtTick: number
  /** 被动触发器的确定性运行时计数与时钟，旧存档可缺省为 0。 */
  basicAttackCount?: number
  nextPassiveTriggerTick?: number
}

export interface FormationReconcileResult {
  ok: boolean
  code: 'OK' | 'POPULATION_LIMIT' | 'DUPLICATE_GENERAL'
  activeFormations: GeneralFormationState[]
  activatedGeneralIds: string[]
  deactivatedGeneralIds: string[]
  populationUsed: number
  blockedGeneralId?: string
}

export interface FixedFormationMovePlan {
  ok: boolean
  code: 'OK' | 'FORMATION_NOT_FOUND' | 'FORMATION_NOT_FIXED' | 'INVALID_TARGET'
  tokenMoves: Array<{
    tokenId: string
    from: { x: number, y: number }
    to: { x: number, y: number }
  }>
}

export interface GeneralCombatEnemy {
  id: string
  xMilli: number
  yMilli: number
  currentHp: number
  pathProgressMilli: number
  spawnSequence: number
  targetable: boolean
  tags: readonly string[]
}

export interface ResolvedGeneralStats {
  attack: number
  attackIntervalMs: number
  attackRangeMilliCells: number
  critChanceBps: number
  critDamageBps: number
  damageDealtRatioBps: number
}

export interface PlannedGeneralAttack {
  sourceGeneralId: string
  sourceProgressId: string
  sourceFormationId: string
  ownerPlayerId: string
  actionKind: 'basic_attack' | 'active_skill'
  actionId: string
  targetEnemyId: string
  damage: {
    effectId: string
    damageType: 'physical' | 'magic'
    baseAttack: number
    coefficientBps: number
    flatDamage: number
    criticalPolicy: 'can_crit' | 'cannot_crit'
    damageDealtRatioBps: number
  }
}

interface GeneralCombatActionBase {
  sourceGeneralId: string
  sourceProgressId: string
  sourceFormationId: string
  ownerPlayerId: string
  actionKind: 'basic_attack' | 'active_skill' | 'passive'
  actionId: string
  effectId: string
  primaryTargetEnemyId: string | null
  targetEnemyIds: readonly string[]
  targetPointMilli: { x: number, y: number } | null
}

export interface GeneralDamageCombatAction extends GeneralCombatActionBase {
  effectType: 'damage'
  targetEnemyId: string
  hitIndex: number
  hitCount: number
  targetIndex: number
  /** 连锁效果每跳衰减基点；非连锁为 0。 */
  bounceDamageFalloffBps: number
  delayMs: number
  damage: PlannedGeneralAttack['damage']
}

export interface GeneralDamageOverTimeCombatAction extends GeneralCombatActionBase {
  effectType: 'damage_over_time'
  damageType: DamageOverTimeEffectDefinition['damageType']
  coefficientBpsPerTick: number
  flatDamagePerTick: number
  tickIntervalMs: number
  durationMs: number
  criticalPolicy: DamageOverTimeEffectDefinition['criticalPolicy']
  stacking: GeneralEffectStacking
}

export interface GeneralStatusApplyCombatAction extends GeneralCombatActionBase {
  effectType: 'status_apply'
  statusId: string
  magnitude: number
  durationMs: number
  chanceBps: number
  stacking: GeneralEffectStacking
}

export interface GeneralPathDisplacementCombatAction extends GeneralCombatActionBase {
  effectType: 'path_displacement'
  direction: PathDisplacementEffectDefinition['direction']
  distanceMilliCells: number
  bossDistanceRatioBps: number
}

export interface GeneralSummonUnitCombatAction extends GeneralCombatActionBase {
  effectType: 'summon_unit'
  summonUnitId: string
  count: number
  durationMs: number
  maxOwnedAlive: number
  spawnRadiusMilliCells: number
  spawnPattern: SummonUnitEffectDefinition['spawnPattern']
  inheritStatRatiosBps: SummonUnitEffectDefinition['inheritStatRatiosBps']
  sourceInactivePolicy: SummonUnitEffectDefinition['sourceInactivePolicy']
}

export interface GeneralSpawnZoneCombatAction extends GeneralCombatActionBase {
  effectType: 'spawn_zone'
  zoneId: string
  shape:
    | { kind: 'circle', radiusMilliCells: number }
    | { kind: 'line', lengthMilliCells: number, halfWidthMilliCells: number }
  durationMs: number
  tickIntervalMs: number
  tickEffects: readonly GeneralZoneTickEffectDefinition[]
  sourceInactivePolicy: SpawnZoneEffectDefinition['sourceInactivePolicy']
}

export interface GeneralCooldownModifyCombatAction extends GeneralCombatActionBase {
  effectType: 'cooldown_modify'
  targetSkill: CooldownModifyEffectDefinition['targetSkill']
  operation: CooldownModifyEffectDefinition['operation']
  value: number
  maxTriggersPerCast: number
}

export interface GeneralEffectParameterPatchCombatAction extends GeneralCombatActionBase {
  effectType: 'effect_parameter_patch'
  targetEffectId: string
  parameter: string
  operation: EffectParameterPatchDefinition['operation']
  value: number
}

export type GeneralCombatAction =
  | GeneralDamageCombatAction
  | GeneralDamageOverTimeCombatAction
  | GeneralStatusApplyCombatAction
  | GeneralPathDisplacementCombatAction
  | GeneralSummonUnitCombatAction
  | GeneralSpawnZoneCombatAction
  | GeneralCooldownModifyCombatAction
  | GeneralEffectParameterPatchCombatAction

export interface GeneralCombatPlan {
  /** 旧 PVE 直伤执行队列；新效果不会被伪装成伤害。 */
  actions: PlannedGeneralAttack[]
  /** 完整的结构化规划，由后续统一效果执行器消费。 */
  combatActions: GeneralCombatAction[]
  nextProgress: GeneralProgressState
}

export interface GeneralPassivePlan {
  actions: GeneralCombatAction[]
  nextBasicAttackCount: number
  nextPassiveTriggerTick: number
}
