import type {
  PveRewardDifficulty,
  PveWaveMilestone,
  WeaponFragmentDrop,
  WeaponRewardAccountState,
} from '../weapon-v1/rewards'
import type { WeaponQuality } from '../weapon-v1/types'

export interface PveRewardStageSelection {
  levelId: number
  stageId: string
  difficulty: PveRewardDifficulty
}

export interface PveRewardPlayerContext {
  matchId: string
  matchSeed: string
  stage: PveRewardStageSelection
  playerId: string
  activatedGeneralIds: readonly string[]
  discoveredGeneralIds: readonly string[]
  weaponState: WeaponRewardAccountState
}

export interface RecordWaveMilestoneInput extends PveRewardPlayerContext {
  milestone: PveWaveMilestone
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
  source: 'wave_milestone' | 'hard_victory_exclusive_guarantee'
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

export type { PveRewardDifficulty, PveWaveMilestone, WeaponFragmentDrop, WeaponRewardAccountState }
