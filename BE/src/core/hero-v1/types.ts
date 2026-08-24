export type GeneralLevel = 1 | 2 | 3 | 4 | 5

export type GeneralArchetype = 'physical' | 'magic' | 'summon' | 'control'

export type GeneralQuality = 'purple' | 'orange' | 'red'

export type LevelCurve = readonly [number, number, number, number, number]

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

export interface DirectDamageEffectDefinition {
  effectId: string
  type: 'damage'
  damageType: 'physical' | 'magic'
  coefficientBpsByLevel: LevelCurve
  flatDamageByLevel: LevelCurve
  criticalPolicy: 'can_crit' | 'cannot_crit'
  targetLimit: 1
  tags: readonly string[]
}

export interface GeneralDefinition {
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
      priority: 'furthest_progress'
      targetLimit: 1
    }
    effect: DirectDamageEffectDefinition
  }
  activeSkill: {
    skillId: string
    skillName: string
    trigger: 'auto'
    cooldownMsByLevel: LevelCurve
    targeting: {
      scope: 'enemies_in_attack_range'
      priority: 'highest_current_hp'
      targetLimit: 1
    }
    effects: readonly DirectDamageEffectDefinition[]
  }
  passiveSkill: {
    skillId: string
    skillName: string
    effects: readonly GeneralStatModifier[]
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

export interface GeneralCombatPlan {
  actions: PlannedGeneralAttack[]
  nextProgress: GeneralProgressState
}
