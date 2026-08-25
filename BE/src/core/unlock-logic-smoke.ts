import assert from 'node:assert/strict'
import { pveStageKey, type PveDifficulty, type PveStageSelection } from '../../../shared/contracts/pve-stage-config'
import type { PveProgressPayload } from '../account-v1/types'
import {
  checkPveStageUnlock,
  createDefaultPveProgress,
  derivePveProgressionView,
} from './unlock-logic'

const AT = '2026-08-25T00:00:00.000Z'

function markCleared(progress: PveProgressPayload, levelId: number, difficulty: PveDifficulty): void {
  const selection: PveStageSelection = { levelId, difficulty }
  const stageKey = pveStageKey(selection)
  progress.clearsByStageKey[stageKey] = {
    stageKey,
    selection,
    clearCount: 1,
    firstClearedAt: AT,
    lastClearedAt: AT,
  }
}

function unlockedKeys(progress: PveProgressPayload): string[] {
  return derivePveProgressionView(progress).stages
    .filter(stage => stage.unlocked)
    .map(stage => stage.stageKey)
    .sort()
}

function main(): void {
  const progress = createDefaultPveProgress()
  assert.deepEqual(unlockedKeys(progress), ['easy:1'])
  assert.equal(checkPveStageUnlock(progress, { levelId: 2, difficulty: 'easy' }).allowed, false)

  for (let levelId = 1; levelId <= 4; levelId++) markCleared(progress, levelId, 'easy')
  assert.equal(checkPveStageUnlock(progress, { levelId: 5, difficulty: 'easy' }).allowed, true)
  assert.equal(checkPveStageUnlock(progress, { levelId: 1, difficulty: 'normal' }).allowed, false)

  markCleared(progress, 5, 'easy')
  for (let levelId = 1; levelId <= 5; levelId++) {
    assert.equal(checkPveStageUnlock(progress, { levelId, difficulty: 'normal' }).allowed, true)
  }
  assert.equal(checkPveStageUnlock(progress, { levelId: 6, difficulty: 'normal' }).allowed, false)

  markCleared(progress, 6, 'easy')
  assert.equal(checkPveStageUnlock(progress, { levelId: 6, difficulty: 'normal' }).allowed, true)
  assert.equal(checkPveStageUnlock(progress, { levelId: 7, difficulty: 'normal' }).allowed, false)

  for (let levelId = 7; levelId <= 10; levelId++) markCleared(progress, levelId, 'easy')
  for (let levelId = 1; levelId <= 10; levelId++) {
    assert.equal(checkPveStageUnlock(progress, { levelId, difficulty: 'normal' }).allowed, true)
  }

  for (let levelId = 1; levelId <= 9; levelId++) markCleared(progress, levelId, 'normal')
  assert.equal(checkPveStageUnlock(progress, { levelId: 1, difficulty: 'hard' }).allowed, false)
  markCleared(progress, 10, 'normal')
  for (let levelId = 1; levelId <= 10; levelId++) {
    assert.equal(checkPveStageUnlock(progress, { levelId, difficulty: 'hard' }).allowed, true)
  }

  assert.equal(checkPveStageUnlock(progress, { levelId: 11, difficulty: 'easy' }).allowed, false)
  assert.equal(derivePveProgressionView(progress).stages.length, 30)
  console.log('unlock-logic smoke passed')
}

main()
