import assert from 'node:assert/strict'
import { PveGameRuntime } from './runtime'
import { createServerConfig } from '../config/server-config'
import { GameEngine } from '../core/game-engine'

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

  // The match may still receive a full global token catalog from the host
  // (including the 佛/净/悟 recipe glyphs).  Per-account selection must be the
  // authoritative recruitment pool so locked generals can never be drawn.
  const guardedRuntime = new PveGameRuntime({
    seed: 'general-selection-locked-glyphs',
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: { 后: 1, 羿: 1, 佛: 1, 净: 1, 悟: 1 },
    generalSelections: {
      player: { unlockedGeneralIds: ['houyi', 'chang_e'], selectedGeneralIds: ['houyi'] },
    },
  })
  assert.equal(guardedRuntime.registerPlayer('player', 'P1').ok, true)
  const guardedPlayer = guardedRuntime.snapshot().players[0]!
  assert.deepEqual(guardedPlayer.remainingCharacterTokens, { 后: 1, 羿: 1 })
  assert.equal(guardedRuntime.handleAction('player', { type: 'RECRUIT_BATCH', actionId: 'guarded-recruit' }).ok, true)
  const drawnGlyphs: string[] = guardedRuntime.snapshot().players[0]!.tray
    .filter((piece): piece is Extract<typeof piece, { kind: 'character' }> => piece?.kind === 'character')
    .map((piece) => String(piece.glyph))
  assert.ok(drawnGlyphs.every((glyph) => glyph === '后' || glyph === '羿'))
  assert.ok(!(drawnGlyphs as string[]).some((glyph: string) => glyph === '佛' || glyph === '净' || glyph === '悟'))

  // A room checkpoint can predate the unlock gate.  Even if such a payload
  // contains a full token map, restoring it must rebind to the current
  // account/build selection before the next recruit.
  const checkpointSource = new PveGameRuntime({
    seed: 'general-selection-checkpoint',
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: { 后: 1, 羿: 1, 佛: 1, 净: 1, 悟: 1 },
    generalSelections: {
      player: { unlockedGeneralIds: ['houyi', 'chang_e'], selectedGeneralIds: ['houyi'] },
    },
  })
  assert.equal(checkpointSource.registerPlayer('player', 'P1').ok, true)
  const checkpoint = checkpointSource.exportCheckpoint() as unknown as {
    players: Array<{ playerId: string; remainingCharacterTokens: Array<[string, number]> }>
  }
  checkpoint.players[0]!.remainingCharacterTokens.push(['佛', 2], ['净', 2], ['悟', 2])
  const checkpointRestored = new PveGameRuntime({
    seed: 'general-selection-checkpoint',
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: { 后: 1, 羿: 1, 佛: 1, 净: 1, 悟: 1 },
    generalSelections: {
      player: { unlockedGeneralIds: ['houyi', 'chang_e'], selectedGeneralIds: ['houyi'] },
    },
  })
  checkpointRestored.restoreCheckpoint(checkpoint as unknown as Record<string, unknown>)
  assert.deepEqual(checkpointRestored.snapshot().players[0]!.remainingCharacterTokens, { 后: 1, 羿: 1 })

  const invalid = new PveGameRuntime({ seed: 'invalid-selection' })
  assert.equal(invalid.registerPlayer('p', 'P1', {
    unlockedGeneralIds: ['houyi'], selectedGeneralIds: ['chang_e'],
  }).code, 'SELECTED_GENERAL_NOT_UNLOCKED')

  // Room players are registered before the account snapshot is locked.  The
  // engine must refresh that waiting runtime when the snapshot arrives,
  // otherwise the initial all-catalog fallback leaks 佛/净/悟 into recruits.
  const engine = new GameEngine({ ...createServerConfig(), authRequired: false })
  engine.registerPlayer({ playerId: 'account-player', playerName: 'Account Player', playerKind: 'human' })
  engine.syncPlayerSlots([{ playerId: 'account-player', slotId: 'P1' }])
  engine.setMatchBuildSnapshots({
    'account-player': {
      snapshotVersion: 1,
      snapshotId: 'build:selection-smoke:account-player',
      matchId: 'selection-smoke',
      playerId: 'account-player',
      accountVersion: 1,
      createdAt: new Date().toISOString(),
      unlockedGeneralIds: ['houyi', 'chang_e', 'yangjian'],
      selectedGeneralIds: ['houyi', 'chang_e', 'yangjian'],
      item: {
        accountVersion: 1,
        activeSlots: [null, null],
        passiveSlots: [null, null, null, null, null, null],
        resolvedActiveDefinitions: [],
        resolvedPassiveDefinitions: [],
      },
      weapon: { accountVersion: 1, byGeneralId: {} },
    },
  })
  const enginePlayer = engine.getStateSnapshot().pve?.players.find((player) => player.playerId === 'account-player')
  assert.ok(enginePlayer)
  assert.deepEqual(enginePlayer.selectedGeneralIds, ['chang_e', 'houyi', 'yangjian'])
  assert.deepEqual(enginePlayer.unlockedGeneralIds, ['chang_e', 'houyi', 'yangjian'])
}

if (require.main === module) {
  runGeneralSelectionSmoke()
  console.log('pve-v2 general selection smoke checks passed')
}
