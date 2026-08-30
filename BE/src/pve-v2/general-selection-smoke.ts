import assert from 'node:assert/strict'
import { PveGameRuntime } from './runtime'

/** Smoke coverage for account unlock + per-match selected-general character pools. */
export function runGeneralSelectionSmoke(): void {
  const runtime = new PveGameRuntime({
    seed: 'general-selection-smoke',
    prepDurationMs: 0,
    maxWaves: 1,
    generalSelections: {
      player: { unlockedGeneralIds: ['houyi', 'chang_e'], selectedGeneralIds: ['houyi'] },
    },
  })
  assert.equal(runtime.registerPlayer('player', 'P1').ok, true)
  const snapshot = runtime.snapshot()
  const player = snapshot.players[0]!
  assert.deepEqual(player.unlockedGeneralIds, ['chang_e', 'houyi'])
  assert.deepEqual(player.selectedGeneralIds, ['houyi'])
  assert.deepEqual(player.remainingCharacterTokens, { 后: 1, 羿: 1 })

  const invalid = new PveGameRuntime({ seed: 'invalid-selection' })
  assert.equal(invalid.registerPlayer('p', 'P1', {
    unlockedGeneralIds: ['houyi'], selectedGeneralIds: ['chang_e'],
  }).code, 'SELECTED_GENERAL_NOT_UNLOCKED')
}

if (require.main === module) {
  runGeneralSelectionSmoke()
  console.log('pve-v2 general selection smoke checks passed')
}
