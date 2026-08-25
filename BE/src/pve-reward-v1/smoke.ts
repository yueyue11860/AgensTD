import assert from 'node:assert/strict'
import { getWeaponDefinition } from '../weapon-v1/catalog'
import { PveRewardLedgerError } from './ledger'
import { PveRewardService } from './service'
import type { PveRewardStageSelection, RecordWaveMilestoneInput } from './types'

const hardStage: PveRewardStageSelection = {
  levelId: 1,
  stageId: 'flower_fruit_mountain_v1',
  difficulty: 'hard',
}

const milestoneInput = (
  matchId: string,
  playerId: string,
  milestone: 5 | 10 | 15 | 20,
  stage: PveRewardStageSelection = hardStage,
): RecordWaveMilestoneInput => ({
  matchId,
  matchSeed: `seed:${matchId}`,
  stage,
  playerId,
  milestone,
  activatedGeneralIds: ['houyi'],
  discoveredGeneralIds: ['houyi'],
  weaponState: { fragmentBalances: {}, unlockedWeaponIds: [] },
})

function checkMilestoneIdempotencyAndFreeze(): void {
  const service = new PveRewardService()
  for (const milestone of [5, 10, 15, 20] as const) {
    const input = milestoneInput('hard-clear', 'p1', milestone)
    const first = service.recordWaveMilestone(input)
    assert.equal(first.duplicate, false)
    assert.equal(first.events.length, milestone === 20 ? 2 : 1)
    for (let retry = 0; retry < 100; retry += 1) {
      const replay = service.recordWaveMilestone(input)
      assert.equal(replay.duplicate, true)
      assert.deepEqual(replay.events, first.events)
    }
  }
  const victory = service.recordMatchOutcome({
    ...milestoneInput('hard-clear', 'p1', 20),
    officialVictory: true,
  })
  assert.equal(victory.events.length, 1)
  assert.equal(victory.events[0].source, 'hard_victory_exclusive_guarantee')
  assert.equal(getWeaponDefinition(victory.events[0].weaponId)?.compatibility.exclusiveGeneralId, 'houyi')

  const frozen = service.ledger.freezePlayerRewards('hard-clear', 'p1')
  assert.equal(frozen.rewardEventIds.length, 6)
  assert.equal(Object.values(frozen.fragmentBalances).reduce((sum, amount) => sum + amount, 0), 6)
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.rewardEventIds) && Object.isFrozen(frozen.fragmentBalances))
}

function checkNoGuaranteeWithoutHardVictory(): void {
  const service = new PveRewardService()
  const defeat = service.recordMatchOutcome({
    ...milestoneInput('hard-defeat', 'p1', 15),
    officialVictory: false,
  })
  assert.deepEqual(defeat.events, [])
  assert.deepEqual(service.ledger.freezePlayerRewards('hard-defeat', 'p1').fragmentBalances, {})

  const simpleVictory = service.recordMatchOutcome({
    ...milestoneInput('simple-win', 'p1', 20, {
      levelId: 1,
      stageId: 'flower_fruit_mountain_v1',
      difficulty: 'easy',
    }),
    officialVictory: true,
  })
  assert.deepEqual(simpleVictory.events, [])
}

function checkConflictsAndPlayerIsolation(): void {
  const service = new PveRewardService()
  const original = milestoneInput('isolation', 'p1', 5)
  service.recordWaveMilestone(original)
  assert.throws(
    () => service.recordWaveMilestone({ ...original, matchSeed: 'tampered-seed' }),
    (error: unknown) => error instanceof PveRewardLedgerError && error.code === 'REWARD_BATCH_CONFLICT',
  )

  for (const playerId of ['p2', 'p3', 'p4']) {
    service.recordWaveMilestone(milestoneInput('isolation', playerId, 5))
  }
  const eventIds = ['p1', 'p2', 'p3', 'p4']
    .flatMap((playerId) => service.ledger.getPlayerEvents('isolation', playerId).map((event) => event.eventId))
  assert.equal(new Set(eventIds).size, 4)
}

export function runPveRewardV1SmokeChecks(): { checks: string[] } {
  checkMilestoneIdempotencyAndFreeze()
  checkNoGuaranteeWithoutHardVictory()
  checkConflictsAndPlayerIsolation()
  return { checks: ['milestone-idempotency', 'hard-victory-exclusive', 'failure-no-guarantee', 'player-isolation'] }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(runPveRewardV1SmokeChecks())}\n`)
