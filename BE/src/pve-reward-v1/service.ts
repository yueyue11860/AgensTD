import {
  PVE_WEAPON_REWARD_TABLE_REVISION,
  rollBossFragmentBonusDrop,
  rollHardVictoryExclusiveWeaponDrop,
  rollWaveMilestoneWeaponDrops,
  type WeaponRewardAccountState,
} from '../weapon-v1/rewards'
import { PveRewardLedger } from './ledger'
import type {
  PveRewardBatchResult,
  PveRewardPlayerContext,
  PveWeaponRewardEvent,
  RecordMatchOutcomeInput,
  RecordWaveMilestoneInput,
} from './types'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}

const milestoneBatchKey = (input: RecordWaveMilestoneInput) => [
  'pve-reward', input.matchId, input.playerId, input.stage.difficulty, `wave-${input.milestone}`,
  PVE_WEAPON_REWARD_TABLE_REVISION,
].join(':')

const outcomeBatchKey = (input: RecordMatchOutcomeInput) => [
  'pve-reward', input.matchId, input.playerId, input.stage.difficulty, 'match-outcome',
  PVE_WEAPON_REWARD_TABLE_REVISION,
].join(':')

export class PveRewardService {
  constructor(readonly ledger = new PveRewardLedger()) {}

  recordWaveMilestone(input: RecordWaveMilestoneInput): PveRewardBatchResult {
    const batchKey = milestoneBatchKey(input)
    const fingerprint = stableStringify(input)
    const replay = this.ledger.readBatch(batchKey, fingerprint)
    if (replay) return replay
    const weaponState = this.effectiveWeaponState(input)
    const dropInput = {
      matchSeed: input.matchSeed,
      stageId: input.stage.stageId,
      levelId: input.stage.levelId,
      difficulty: input.stage.difficulty,
      playerId: input.playerId,
      milestone: input.milestone,
      activatedGeneralIds: input.activatedGeneralIds,
      discoveredGeneralIds: input.discoveredGeneralIds,
      weaponState,
    }
    const baseDrops = rollWaveMilestoneWeaponDrops(dropInput)
    const drops = [...baseDrops]
    const bonus = input.bossFragmentBonus
    if (bonus && baseDrops.length > 0) {
      if (
        bonus.extraCount !== 1
        || bonus.maxExtraPerBoss !== 1
        || bonus.qualityPolicy !== 'same_quality_random_fragment'
      ) throw new Error('Unsupported Boss fragment bonus policy')
      const referenceDrop = baseDrops[baseDrops.length - 1]
      const bonusDrop = rollBossFragmentBonusDrop({
        ...dropInput,
        chanceBps: bonus.chanceBps,
        bonusDropIndex: baseDrops.length,
        quality: referenceDrop.quality,
      })
      if (bonusDrop) drops.push(bonusDrop)
    }
    const events = drops.map((drop): PveWeaponRewardEvent => ({
      schemaVersion: 1,
      eventId: [batchKey, `drop-${drop.dropIndex}`].join(':'),
      rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
      matchId: input.matchId,
      playerId: input.playerId,
      stage: { ...input.stage },
      source: drop.dropIndex < baseDrops.length ? 'wave_milestone' : 'boss_fragment_bonus',
      milestone: input.milestone,
      ...drop,
    }))
    return this.ledger.recordBatch(batchKey, fingerprint, events)
  }

  recordMatchOutcome(input: RecordMatchOutcomeInput): PveRewardBatchResult {
    const batchKey = outcomeBatchKey(input)
    const fingerprint = stableStringify(input)
    const replay = this.ledger.readBatch(batchKey, fingerprint)
    if (replay) return replay
    if (!input.officialVictory || input.stage.difficulty !== 'hard') {
      return this.ledger.recordBatch(batchKey, fingerprint, [])
    }
    const drop = rollHardVictoryExclusiveWeaponDrop({
      matchSeed: input.matchSeed,
      stageId: input.stage.stageId,
      levelId: input.stage.levelId,
      playerId: input.playerId,
      activatedGeneralIds: input.activatedGeneralIds,
      discoveredGeneralIds: input.discoveredGeneralIds,
      weaponState: this.effectiveWeaponState(input),
    })
    const event: PveWeaponRewardEvent = {
      schemaVersion: 1,
      eventId: [batchKey, 'exclusive-drop-0'].join(':'),
      rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
      matchId: input.matchId,
      playerId: input.playerId,
      stage: { ...input.stage },
      source: 'hard_victory_exclusive_guarantee',
      ...drop,
    }
    return this.ledger.recordBatch(batchKey, fingerprint, [event])
  }

  private effectiveWeaponState(input: PveRewardPlayerContext): WeaponRewardAccountState {
    const pending = this.ledger.getPlayerFragmentBalances(input.matchId, input.playerId)
    const fragmentBalances = { ...input.weaponState.fragmentBalances }
    for (const [weaponId, amount] of Object.entries(pending)) {
      fragmentBalances[weaponId] = (fragmentBalances[weaponId] ?? 0) + amount
    }
    return { fragmentBalances, unlockedWeaponIds: input.weaponState.unlockedWeaponIds }
  }
}
