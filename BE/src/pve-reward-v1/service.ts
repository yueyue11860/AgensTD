import {
  PVE_WEAPON_REWARD_TABLE_REVISION,
  rollBossFragmentBonusDrop,
  rollHardVictoryExclusiveWeaponDrop,
  rollWaveMilestoneWeaponDrops,
  type WeaponRewardAccountState,
} from '../weapon-v1/rewards'
import { MemoryPveRewardStore } from './memory-store'
import { PveRewardStoreConflictError, type PveRewardStore } from './store'
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
  constructor(readonly store: PveRewardStore = new MemoryPveRewardStore()) {}

  async recordWaveMilestone(input: RecordWaveMilestoneInput): Promise<PveRewardBatchResult> {
    this.assertAuthoritativeContext(input)
    const batchKey = milestoneBatchKey(input)
    const fingerprint = stableStringify(input)
    const replay = await this.store.getBatch(batchKey)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new PveRewardStoreConflictError(
        'REWARD_BATCH_CONFLICT', `Reward batch ${batchKey} conflicts with stored facts`,
      )
      return { batchKey, duplicate: true, events: replay.events }
    }
    const weaponState = await this.effectiveWeaponState(input)
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
    const recorded = await this.store.recordBatch({
      batchKey, fingerprint, matchId: input.matchId, playerId: input.playerId,
      combatRulesetVersion: input.combatRulesetVersion, configSnapshot: structuredClone(input.configSnapshot),
      kind: 'wave_milestone', events, createdAt: new Date().toISOString(),
    })
    return { batchKey, duplicate: recorded.duplicate, events: recorded.batch.events }
  }

  async recordMatchOutcome(input: RecordMatchOutcomeInput): Promise<PveRewardBatchResult> {
    this.assertAuthoritativeContext(input)
    const batchKey = outcomeBatchKey(input)
    const fingerprint = stableStringify(input)
    const replay = await this.store.getBatch(batchKey)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new PveRewardStoreConflictError(
        'REWARD_BATCH_CONFLICT', `Reward batch ${batchKey} conflicts with stored facts`,
      )
      return { batchKey, duplicate: true, events: replay.events }
    }
    if (!input.officialVictory || input.stage.difficulty !== 'hard') {
      const recorded = await this.store.recordBatch({
        batchKey, fingerprint, matchId: input.matchId, playerId: input.playerId,
        combatRulesetVersion: input.combatRulesetVersion, configSnapshot: structuredClone(input.configSnapshot),
        kind: 'match_outcome', events: [], createdAt: new Date().toISOString(),
      })
      return { batchKey, duplicate: recorded.duplicate, events: recorded.batch.events }
    }
    const drop = rollHardVictoryExclusiveWeaponDrop({
      matchSeed: input.matchSeed,
      stageId: input.stage.stageId,
      levelId: input.stage.levelId,
      playerId: input.playerId,
      activatedGeneralIds: input.activatedGeneralIds,
      discoveredGeneralIds: input.discoveredGeneralIds,
      weaponState: await this.effectiveWeaponState(input),
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
    const recorded = await this.store.recordBatch({
      batchKey, fingerprint, matchId: input.matchId, playerId: input.playerId,
      combatRulesetVersion: input.combatRulesetVersion, configSnapshot: structuredClone(input.configSnapshot),
      kind: 'match_outcome', events: [event], createdAt: new Date().toISOString(),
    })
    return { batchKey, duplicate: recorded.duplicate, events: recorded.batch.events }
  }

  async freezePlayerRewards(matchId: string, playerId: string) {
    const batches = await this.store.listPlayerBatches(matchId, playerId)
    const events = batches.flatMap(batch => batch.events).sort((left, right) => left.eventId.localeCompare(right.eventId))
    const fragmentBalances: Record<string, number> = {}
    for (const event of events) fragmentBalances[event.weaponId] = (fragmentBalances[event.weaponId] ?? 0) + event.amount
    return Object.freeze({
      matchId,
      playerId,
      rewardEventIds: Object.freeze(events.map(event => event.eventId)),
      fragmentBalances: Object.freeze(fragmentBalances),
    })
  }

  private async effectiveWeaponState(input: PveRewardPlayerContext): Promise<WeaponRewardAccountState> {
    const pending = (await this.freezePlayerRewards(input.matchId, input.playerId)).fragmentBalances
    const fragmentBalances = { ...input.weaponState.fragmentBalances }
    for (const [weaponId, amount] of Object.entries(pending)) {
      fragmentBalances[weaponId] = (fragmentBalances[weaponId] ?? 0) + amount
    }
    return { fragmentBalances, unlockedWeaponIds: input.weaponState.unlockedWeaponIds }
  }

  private assertAuthoritativeContext(input: PveRewardPlayerContext): void {
    const snapshot = input.configSnapshot
    if (snapshot.runtimeKind !== 'pve-v2'
      || input.combatRulesetVersion !== snapshot.combatRulesetVersion
      || input.stage.levelId !== snapshot.levelId
      || input.stage.stageId !== snapshot.stageId
      || input.stage.difficulty !== snapshot.difficulty) {
      throw new Error('PVE_REWARD_RULESET_SNAPSHOT_MISMATCH')
    }
  }
}
