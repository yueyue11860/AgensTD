import assert from 'node:assert/strict'
import { getWeaponDefinition } from '../weapon-v1/catalog'
import { PveRewardStoreConflictError } from './store'
import { PveRewardService } from './service'
import type { PveRewardStageSelection, RecordWaveMilestoneInput } from './types'
import { PveGameRuntime } from '../pve-v2'
import { MemoryPveRewardStore } from './memory-store'

const hardStage: PveRewardStageSelection = {
  levelId: 1,
  stageId: 'flower_fruit_mountain_v1',
  difficulty: 'hard',
}

const configSnapshot = new PveGameRuntime({ seed: 'reward-smoke-config', levelId: 1, difficulty: 'hard' })
  .snapshot().configSnapshot

const milestoneInput = (
  matchId: string,
  playerId: string,
  milestone: 5 | 10 | 15 | 20,
  stage: PveRewardStageSelection = hardStage,
): RecordWaveMilestoneInput => ({
  matchId,
  matchSeed: `seed:${matchId}`,
  combatRulesetVersion: configSnapshot.combatRulesetVersion,
  configSnapshot: stage.difficulty === 'hard'
    ? configSnapshot
    : new PveGameRuntime({ seed: `reward-smoke-${stage.difficulty}`, levelId: stage.levelId, difficulty: stage.difficulty })
      .snapshot().configSnapshot,
  stage,
  playerId,
  milestone,
  activatedGeneralIds: ['houyi'],
  discoveredGeneralIds: ['houyi'],
  weaponState: { fragmentBalances: {}, unlockedWeaponIds: [] },
})

async function checkMilestoneIdempotencyAndFreeze(): Promise<void> {
  const durableStore = new MemoryPveRewardStore()
  let service = new PveRewardService(durableStore)
  for (const milestone of [5, 10, 15, 20] as const) {
    const input = milestoneInput('hard-clear', 'p1', milestone)
    const first = await service.recordWaveMilestone(input)
    assert.equal(first.duplicate, false)
    assert.equal(first.events.length, milestone === 20 ? 2 : 1)
    for (let retry = 0; retry < 100; retry += 1) {
      if (retry === 0) service = new PveRewardService(durableStore)
      const replay = await service.recordWaveMilestone(input)
      assert.equal(replay.duplicate, true)
      assert.deepEqual(replay.events, first.events)
    }
  }
  const victory = await service.recordMatchOutcome({
    ...milestoneInput('hard-clear', 'p1', 20),
    officialVictory: true,
  })
  assert.equal(victory.events.length, 1)
  assert.equal(victory.events[0].source, 'hard_victory_exclusive_guarantee')
  assert.equal(getWeaponDefinition(victory.events[0].weaponId)?.compatibility.exclusiveGeneralId, 'houyi')

  const frozen = await service.freezePlayerRewards('hard-clear', 'p1')
  assert.equal(frozen.rewardEventIds.length, 6)
  assert.equal(Object.values(frozen.fragmentBalances).reduce((sum, amount) => sum + amount, 0), 6)
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.rewardEventIds) && Object.isFrozen(frozen.fragmentBalances))
}

async function checkNoGuaranteeWithoutHardVictory(): Promise<void> {
  const service = new PveRewardService()
  const defeat = await service.recordMatchOutcome({
    ...milestoneInput('hard-defeat', 'p1', 15),
    officialVictory: false,
  })
  assert.deepEqual(defeat.events, [])
  assert.deepEqual((await service.freezePlayerRewards('hard-defeat', 'p1')).fragmentBalances, {})

  const simpleVictory = await service.recordMatchOutcome({
    ...milestoneInput('simple-win', 'p1', 20, {
      levelId: 1,
      stageId: 'flower_fruit_mountain_v1',
      difficulty: 'easy',
    }),
    officialVictory: true,
  })
  assert.deepEqual(simpleVictory.events, [])
}

async function checkConflictsAndPlayerIsolation(): Promise<void> {
  const service = new PveRewardService()
  const original = milestoneInput('isolation', 'p1', 5)
  await service.recordWaveMilestone(original)
  await assert.rejects(
    service.recordWaveMilestone({ ...original, matchSeed: 'tampered-seed' }),
    (error: unknown) => error instanceof PveRewardStoreConflictError && error.code === 'REWARD_BATCH_CONFLICT',
  )
  await assert.rejects(
    service.recordWaveMilestone({
      ...milestoneInput('ruleset-mismatch', 'p1', 5),
      configSnapshot: { ...original.configSnapshot, stageId: 'legacy-or-tampered-stage' },
    }),
    /PVE_REWARD_RULESET_SNAPSHOT_MISMATCH/,
  )

  for (const playerId of ['p2', 'p3', 'p4']) {
    await service.recordWaveMilestone(milestoneInput('isolation', playerId, 5))
  }
  const eventIds = ['p1', 'p2', 'p3', 'p4']
    .flatMap(async (playerId) => (await service.store.listPlayerBatches('isolation', playerId))
      .flatMap(batch => batch.events.map(event => event.eventId)))
  const resolvedEventIds = (await Promise.all(eventIds)).flat()
  assert.equal(new Set(resolvedEventIds).size, 4)
}

async function checkBossFragmentBonus(): Promise<void> {
  const service = new PveRewardService()
  const input: RecordWaveMilestoneInput = {
    ...milestoneInput('boss-bonus', 'p1', 5),
    bossFragmentBonus: {
      chanceBps: 10_000,
      extraCount: 1,
      maxExtraPerBoss: 1,
      qualityPolicy: 'same_quality_random_fragment',
    },
  }
  const first = await service.recordWaveMilestone(input)
  assert.equal(first.events.length, 2)
  assert.equal(first.events[1].source, 'boss_fragment_bonus')
  assert.equal(first.events[1].quality, first.events[0].quality)
  assert.deepEqual((await service.recordWaveMilestone(input)).events, first.events)
}

export async function runPveRewardV1SmokeChecks(): Promise<{ checks: string[] }> {
  await checkMilestoneIdempotencyAndFreeze()
  await checkNoGuaranteeWithoutHardVictory()
  await checkConflictsAndPlayerIsolation()
  await checkBossFragmentBonus()
  return { checks: ['milestone-idempotency', 'service-restart-ledger-replay', 'hard-victory-exclusive', 'failure-no-guarantee', 'player-isolation', 'boss-fragment-bonus', 'ruleset-snapshot-gate'] }
}

if (require.main === module) void runPveRewardV1SmokeChecks()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
