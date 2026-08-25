export const ITEM_SCHEMA_VERSION = 1 as const
export const ITEM_CATALOG_VERSION = 1 as const
export const ITEM_SNAPSHOT_VERSION = 1 as const

export type ItemId = string
export type ItemKind = 'active' | 'passive'
export type ItemStatus = 'prototype' | 'testing' | 'released'
export type MatchPhase = 'idle' | 'prep' | 'spawning' | 'clearing' | 'complete'
export type ActiveMatchPhase = Exclude<MatchPhase, 'idle' | 'complete'>

export interface ItemDefinitionBase {
  schemaVersion: typeof ITEM_SCHEMA_VERSION
  itemId: ItemId
  name: string
  itemKind: ItemKind
  exclusiveGroup?: string
  tags: readonly string[]
  ui: {
    shortDescription: string
    detailDescription: string
    iconKey: string
  }
  status: ItemStatus
}

export type ActiveItemTargetKind =
  | 'none'
  | 'character_token'
  | 'active_general'
  | 'battlefield_point'
  | 'discarded_character_to_empty_slot'

export interface ActiveItemTargeting {
  kind: ActiveItemTargetKind
  ownerPolicy: 'self_only' | 'any_targetable_enemy'
  allowedZones?: readonly ('summon_tray' | 'reserve' | 'board' | 'discard')[]
  radiusMilliCells?: number
}

export type ItemEffectTargetScope =
  | 'target_general'
  | 'enemies_in_radius'
  | 'owner_physical_generals'
  | 'owner_magic_generals'
  | 'owner_control_generals'
  | 'summons_owned_by_player'

export type StructuredItemEffect =
  | {
      effectId: string
      type: 'current_health_true_damage'
      target: 'enemies_in_radius'
      radiusMilliCells: number
      normalCurrentHpRatioBps: number
      bossCurrentHpRatioBps: number
      minimumRemainingHp: number
      canCrit: false
      excludesSpawnProtected: true
      grantsGeneralContribution: false
    }
  | {
      effectId: string
      type: 'status_apply'
      target: 'enemies_in_radius'
      radiusMilliCells: number
      statusId: 'slow' | 'root'
      magnitudeBps: number
      normalDurationMs: number
      bossBaseDurationMs: number
      obeysControlDiminishingReturns: true
      obeysBossControlResistance: true
      grantsGeneralContribution: false
    }
  | {
      effectId: string
      type: 'timed_stat_modifier'
      target: 'target_general'
      stat: 'attack' | 'attackSpeed' | 'activeSkillDamage'
      operation: 'add_ratio'
      valueBps: number
      durationMs: number
      stackGroup: string
      inactivePolicy: 'continue_timer_restore_if_reformed'
    }
  | {
      effectId: string
      type: 'persistent_stat_modifier'
      target: ItemEffectTargetScope
      stat:
        | 'attack'
        | 'magicDamage'
        | 'summonDamage'
        | 'summonDuration'
        | 'controlDuration'
      operation: 'add_ratio'
      valueBps: number
      stackGroup: string
    }

export type RegisteredRuleAction =
  | {
      actionId: string
      type: 'replace_character_token'
      candidatePolicy: 'remaining_other_general_character_equal_weight'
      originalTokenDestination: 'discard'
      rescanPolicy: 'affected_board_line'
    }
  | {
      actionId: string
      type: 'grant_general_experience'
      experiencePoints: number
      obeyCurrentLevelCap: true
    }
  | {
      actionId: string
      type: 'grant_general_level'
      levels: 1
      grantOnlyMissingExperience: true
      obeyCurrentLevelCap: true
    }
  | {
      actionId: string
      type: 'refresh_summon_tray'
      slotCount: 5
      animationMs: number
      costRations: 0
      incrementsPaidRecruitCount: false
      contributesToPity: false
      appliesFirstBatchSoldierRule: false
    }
  | {
      actionId: string
      type: 'recover_discarded_character'
      forbidsSoldier: true
      preserveTokenIdentity: true
    }

export interface ActiveItemDefinition extends ItemDefinitionBase {
  itemKind: 'active'
  availabilityPhases: readonly ActiveMatchPhase[]
  targeting: ActiveItemTargeting
  maxChargesPerMatch: number
  cooldownMs: number
  effects: readonly StructuredItemEffect[]
  actions: readonly RegisteredRuleAction[]
  failurePolicy: 'no_consume'
}

export type RegisteredRuleModifier =
  | { modifierId: string; type: 'starting_rations'; addFlat: number }
  | { modifierId: string; type: 'paid_recruit_cost'; addFlat: number; minimumCost: number }
  | { modifierId: string; type: 'own_lane_wave_clear_rations'; addFlat: number }
  | { modifierId: string; type: 'character_probability'; probabilityBps: number }
  | {
      modifierId: string
      type: 'paid_recruit_character_pity'
      triggerAfterNoCharacterBatches: number
      guaranteedCharacters: 1
      excludesFreeRefresh: true
      resetsOnAnyCharacter: true
      respectsFirstBatchSoldierRule: true
    }
  | { modifierId: string; type: 'reserve_capacity'; addFlat: number }
  | { modifierId: string; type: 'population_cap'; addFlat: number; changesBoardArea: false }
  | {
      modifierId: string
      type: 'general_level_cap'
      quality: 'purple' | 'orange'
      maxLevel: 5
      grantsExperience: false
    }
  | {
      modifierId: string
      type: 'general_experience_gain'
      addRatioBps: number
      rounding: 'floor_after_weighted_distribution'
    }
  | {
      modifierId: string
      type: 'boss_fragment_bonus'
      chanceBps: number
      extraCount: 1
      qualityPolicy: 'same_quality_random_fragment'
      maxExtraPerBoss: 1
    }

export type RegisteredItemListener =
  | { listenerId: string; event: 'own_lane_wave_cleared'; action: 'grant_rations' }
  | { listenerId: string; event: 'paid_recruit_batch_resolved'; action: 'update_character_pity' }
  | { listenerId: string; event: 'personal_boss_fragment_dropped'; action: 'roll_extra_fragment' }

export interface PassiveItemDefinition extends ItemDefinitionBase {
  itemKind: 'passive'
  scope: 'owner_global' | 'team_global'
  attachAt: 'player_match_state_initialized'
  effects: readonly StructuredItemEffect[]
  ruleModifiers: readonly RegisteredRuleModifier[]
  eventListeners: readonly RegisteredItemListener[]
  stacking: {
    group: string
    policy: 'unique' | 'highest' | 'additive'
  }
}

export type ItemDefinition = ActiveItemDefinition | PassiveItemDefinition
export type ResolvedActiveItemDefinition = Readonly<ActiveItemDefinition>
export type ResolvedPassiveItemDefinition = Readonly<PassiveItemDefinition>

export type ActiveItemSlots = readonly [ItemId | null, ItemId | null]
export type PassiveItemSlots = readonly [
  ItemId | null,
  ItemId | null,
  ItemId | null,
  ItemId | null,
  ItemId | null,
  ItemId | null,
]

export interface PlayerItemAccount {
  playerId: string
  unlockedActiveItemIds: ItemId[]
  unlockedPassiveItemIds: ItemId[]
  loadout: {
    activeSlots: [ItemId | null, ItemId | null]
    passiveSlots: [
      ItemId | null,
      ItemId | null,
      ItemId | null,
      ItemId | null,
      ItemId | null,
      ItemId | null,
    ]
    version: number
    updatedAt: string
  }
  version: number
}

export interface MatchItemLoadoutSnapshot {
  readonly snapshotVersion: typeof ITEM_SNAPSHOT_VERSION
  readonly catalogVersion: typeof ITEM_CATALOG_VERSION
  readonly playerId: string
  readonly accountVersion: number
  readonly activeItems: readonly ResolvedActiveItemDefinition[]
  readonly passiveItems: readonly ResolvedPassiveItemDefinition[]
  readonly activeSlots: ActiveItemSlots
  readonly passiveSlots: PassiveItemSlots
}

export type ActiveItemTarget =
  | { kind: 'none' }
  | {
      kind: 'tile'
      zone: 'summon_tray' | 'reserve' | 'board'
      index?: number
      x?: number
      y?: number
    }
  | { kind: 'piece'; pieceId: string; expectedRevision: number }
  | { kind: 'general'; generalId: string }
  | { kind: 'enemy'; enemyId: string }
  | { kind: 'battlefield_point'; xMilli: number; yMilli: number }
  | {
      kind: 'discarded_character_to_empty_slot'
      tokenId: string
      expectedTokenRevision: number
      destination: { zone: 'summon_tray' | 'reserve'; index: number; expectedRevision: number }
    }

export interface UseActiveItemCommand {
  type: 'USE_ACTIVE_ITEM'
  requestId: string
  playerId: string
  slotIndex: 0 | 1
  itemId: ItemId
  target: ActiveItemTarget
  expectedItemRuntimeVersion: number
}

export interface ActiveItemRuntimeState {
  itemId: ItemId
  slotIndex: 0 | 1
  chargesRemaining: number
  cooldownEndsAtTick: number
  usesThisMatch: number
  enabled: boolean
}

export type ItemErrorCode =
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NOT_UNLOCKED'
  | 'ITEM_NOT_EQUIPPED'
  | 'ITEM_KIND_MISMATCH'
  | 'NO_ITEM_CHARGES'
  | 'ITEM_ON_COOLDOWN'
  | 'ITEM_NOT_AVAILABLE_IN_PHASE'
  | 'INVALID_ITEM_TARGET'
  | 'TARGET_REVISION_MISMATCH'
  | 'FIXED_GENERAL_MUST_BE_RELEASED'
  | 'NO_CHARACTER_CANDIDATE'
  | 'NO_EMPTY_DESTINATION'
  | 'GENERAL_LEVEL_CAP_REACHED'
  | 'STALE_ITEM_RUNTIME_VERSION'
  | 'DUPLICATE_ITEM_IN_LOADOUT'
  | 'ITEM_EXCLUSIVE_GROUP_CONFLICT'
  | 'INVALID_ITEM_LOADOUT'
  | 'ITEM_CATALOG_VERSION_MISMATCH'
  | 'ITEM_ACCOUNT_VERSION_MISMATCH'
  | 'ITEM_PURCHASE_ENTITLEMENT_NOT_FOUND'
  | 'ITEM_PURCHASE_ENTITLEMENT_CONSUMED'
  | 'ITEM_PURCHASE_OFFER_MISMATCH'
  | 'ITEM_ALREADY_UNLOCKED'
  | 'INSUFFICIENT_META_GOLD'

export type ItemResult<T> = { ok: true; value: T } | { ok: false; error: ItemErrorCode }

export interface ItemExecutionPlan {
  requestId: string
  playerId: string
  itemId: ItemId
  slotIndex: 0 | 1
  useSequence: number
  tick: number
  target: ActiveItemTarget
  sourceKey: string
  effects: readonly StructuredItemEffect[]
  actions: readonly RegisteredRuleAction[]
}

export interface ItemTargetValidationResult {
  ok: boolean
  error?: Extract<
    ItemErrorCode,
    | 'INVALID_ITEM_TARGET'
    | 'TARGET_REVISION_MISMATCH'
    | 'FIXED_GENERAL_MUST_BE_RELEASED'
    | 'NO_CHARACTER_CANDIDATE'
    | 'NO_EMPTY_DESTINATION'
    | 'GENERAL_LEVEL_CAP_REACHED'
  >
  hasLegalTarget?: boolean
}

export interface ItemRuntimeAggregate {
  matchId: string
  playerId: string
  version: number
  nextUseSequence: number
  slots: readonly [ActiveItemRuntimeState | null, ActiveItemRuntimeState | null]
  processedRequests: Readonly<Record<string, ItemUseReceipt>>
}

export type ItemUseReceipt =
  | { ok: true; runtimeVersion: number; plan: ItemExecutionPlan }
  | { ok: false; runtimeVersion: number; error: ItemErrorCode }

export type UseActiveItemResult =
  | {
      ok: true
      requestId: string
      runtimeVersion: number
      state: ItemRuntimeAggregate
      plan: ItemExecutionPlan
    }
  | {
      ok: false
      requestId: string
      runtimeVersion: number
      error: ItemErrorCode
      state: ItemRuntimeAggregate
    }

export interface ItemRuntimeContext {
  currentTick: number
  tickDurationMs: number
  phase: MatchPhase
  validateTarget: (
    definition: ResolvedActiveItemDefinition,
    target: ActiveItemTarget,
  ) => ItemTargetValidationResult
}

export interface PassiveRuleProjection {
  playerId: string
  sourceKeys: readonly string[]
  startingRationsBonus: number
  paidRecruitCostFlat: number
  paidRecruitMinimumCost: number
  ownLaneWaveClearRationsBonus: number
  characterProbabilityBps?: number
  characterPity?: Extract<RegisteredRuleModifier, { type: 'paid_recruit_character_pity' }>
  reserveCapacityBonus: number
  populationCapBonus: number
  generalLevelCaps: Readonly<Partial<Record<'purple' | 'orange', 5>>>
  generalExperienceGainBps: number
  combatEffects: readonly {
    sourceKey: string
    itemId: ItemId
    slotIndex: number
    effect: StructuredItemEffect
  }[]
  bossFragmentBonus?: Extract<RegisteredRuleModifier, { type: 'boss_fragment_bonus' }>
  listeners: readonly RegisteredItemListener[]
}

export type ItemPurchaseCategory = 'active_item' | 'passive_item'

export interface ItemPurchaseEntitlement {
  entitlementId: string
  playerId: string
  category: ItemPurchaseCategory
  status: 'available' | 'consumed'
  version: number
  offeredCandidateItemIds?: readonly ItemId[]
  consumedByRequestId?: string
}

export interface ItemShopOffer {
  entitlementId: string
  playerId: string
  category: ItemPurchaseCategory
  catalogVersion: typeof ITEM_CATALOG_VERSION
  candidateItemIds: readonly ItemId[]
  priceMetaGold: 10
}

export interface ItemPurchaseAggregate {
  account: PlayerItemAccount
  metaGold: number
  economyVersion: number
  entitlements: Readonly<Record<string, ItemPurchaseEntitlement>>
  processedRequests: Readonly<Record<string, ItemPurchaseReceipt>>
}

export type ItemPurchaseReceipt =
  | { ok: true; unlockedItemId: ItemId }
  | { ok: false; error: ItemErrorCode }

export interface PurchaseItemUnlockCommand {
  requestId: string
  playerId: string
  entitlementId: string
  itemId: ItemId
  expectedAccountVersion: number
  expectedEconomyVersion: number
  expectedEntitlementVersion: number
  expectedCatalogVersion: typeof ITEM_CATALOG_VERSION
}

export type PurchaseItemUnlockResult =
  | { ok: true; requestId: string; aggregate: ItemPurchaseAggregate; unlockedItemId: ItemId }
  | { ok: false; requestId: string; error: ItemErrorCode; aggregate: ItemPurchaseAggregate }
