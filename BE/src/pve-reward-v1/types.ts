import type {
  PveRewardDifficulty,
  PveWaveMilestone,
  WeaponFragmentDrop,
  WeaponRewardAccountState,
} from '../weapon-v1/rewards'
import type { WeaponQuality } from '../weapon-v1/types'
import type { MatchPlayerSettlement } from '../account-v1/types'
import type { SettleMatchInput } from '../account-v1/service'
import type { PveMatchConfigSnapshot } from '../pve-v2/ruleset'

export interface PveRewardStageSelection {
  levelId: number
  stageId: string
  difficulty: PveRewardDifficulty
}

export interface PveRewardPlayerContext {
  matchId: string
  matchSeed: string
  combatRulesetVersion: PveMatchConfigSnapshot['combatRulesetVersion']
  configSnapshot: PveMatchConfigSnapshot
  stage: PveRewardStageSelection
  playerId: string
  activatedGeneralIds: readonly string[]
  discoveredGeneralIds: readonly string[]
  weaponState: WeaponRewardAccountState
}

export interface RecordWaveMilestoneInput extends PveRewardPlayerContext {
  milestone: PveWaveMilestone
  bossFragmentBonus?: {
    chanceBps: number
    extraCount: 1
    maxExtraPerBoss: 1
    qualityPolicy: 'same_quality_random_fragment'
  }
}

export interface RecordMatchOutcomeInput extends PveRewardPlayerContext {
  /** 只能由权威战斗结果设置；false 不会生成专武保底。 */
  officialVictory: boolean
}

export interface PveWeaponRewardEvent {
  schemaVersion: 1
  eventId: string
  rewardTableRevision: string
  matchId: string
  playerId: string
  stage: PveRewardStageSelection
  source: 'wave_milestone' | 'boss_fragment_bonus' | 'hard_victory_exclusive_guarantee'
  milestone?: PveWaveMilestone
  dropIndex: number
  weaponId: string
  quality: WeaponQuality
  amount: 1
}

export interface PveRewardBatchResult {
  batchKey: string
  duplicate: boolean
  events: readonly PveWeaponRewardEvent[]
}

export interface FrozenPvePlayerRewards {
  matchId: string
  playerId: string
  rewardEventIds: readonly string[]
  fragmentBalances: Readonly<Record<string, number>>
}

export interface StoredPveRewardBatch {
  batchKey: string
  fingerprint: string
  matchId: string
  playerId: string
  combatRulesetVersion: PveMatchConfigSnapshot['combatRulesetVersion']
  configSnapshot: PveMatchConfigSnapshot
  kind: 'wave_milestone' | 'match_outcome'
  events: readonly PveWeaponRewardEvent[]
  createdAt: string
}

export type PveSettlementStatus = 'pending' | 'committed' | 'failed'

export interface PveSettlementScoreBasis {
  metric: 'damage' | 'control' | 'rescues' | 'kills'
  value: number
  weightBps: number
  contributionBps: number
}

export interface PveSettlementRewardDetail {
  kind: 'gold' | 'weapon_fragment' | 'purchase_right' | 'first_clear'
  rewardId: string
  label: string
  amount: number
  source: 'match_tier' | 'wave_milestone' | 'boss_fragment_bonus' | 'hard_victory_guarantee' | 'stage_first_clear'
  rarity: 'standard' | WeaponQuality
  milestoneWave?: number
  firstClear?: boolean
}

/**
 * Persisted, server-authored presentation facts. Nullable statistics are deliberate:
 * an unavailable metric must never be reconstructed by the browser.
 */
export interface PveSettlementDetail {
  schemaVersion: 1
  rules: {
    combatRulesetVersion: string
    rewardTableRevision: string
    stageCatalogRevision: string
    balanceCatalogRevision: string
  }
  outcome: {
    victory: boolean
    reason: SettleMatchInput['reason']
    highestCompletedWave: number
    maxWaves: number
  }
  story: {
    title: string
    summary: string
    failureSuggestion: string | null
  }
  performance: {
    damageDealt: number | null
    kills: number | null
    controlAppliedMs: number | null
    rescues: number | null
    mostDangerousWave: number | null
    coverage: 'complete' | 'partial'
  }
  lineup: {
    coreGeneral: { generalId: string; name: string; level: number; damageDealt: number | null } | null
    activeSynergies: Array<{ synergyId: string; name: string; level: number }>
  }
  mvp: {
    playerId: string
    scoreBps: number
    scoreVersion: 'pve-settlement-score-v1'
    basis: PveSettlementScoreBasis[]
  } | null
  rewards: PveSettlementRewardDetail[]
  /** No authoritative pity ledger exists yet; omission is part of the contract. */
  pity: null
}

export interface PveSettlementCommand {
  settlementId: string
  combatRulesetVersion: PveMatchConfigSnapshot['combatRulesetVersion']
  configSnapshot: PveMatchConfigSnapshot
  rewardTableRevision: string
  /** Added in settlement detail v1; absent durable rows remain recoverable. */
  detail?: PveSettlementDetail
  input: SettleMatchInput
}

export interface PveSettlementRecord extends PveSettlementCommand {
  fingerprint: string
  status: PveSettlementStatus
  attempts: number
  lastError: string | null
  settlement: MatchPlayerSettlement | null
  createdAt: string
  updatedAt: string
}

export type { PveRewardDifficulty, PveWaveMilestone, WeaponFragmentDrop, WeaponRewardAccountState }
