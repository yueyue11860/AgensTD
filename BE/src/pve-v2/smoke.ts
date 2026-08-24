import assert from 'node:assert/strict'
import { getDefaultSoldierPlacement, isDefaultDeployableCell } from './arena'
import { PveGameRuntime } from './runtime'
import type { PveRuntimeSnapshot, SoldierPiece } from './types'

function firstSoldier(snapshot: PveRuntimeSnapshot): { index: number, piece: SoldierPiece } {
  const tray = snapshot.players[0]?.tray ?? []
  for (let index = 0; index < tray.length; index += 1) {
    const piece = tray[index]
    if (piece?.kind === 'soldier') {
      return { index, piece }
    }
  }
  throw new Error('First recruit batch did not contain a soldier')
}

function createPreparedRuntime(seed: string): PveGameRuntime {
  const runtime = new PveGameRuntime({
    seed,
    tickRateMs: 100,
    prepDurationMs: 0,
    maxWaves: 1,
    characterTokens: {
      杨: 2,
      戬: 2,
      孙: 2,
      悟: 2,
      空: 2,
    },
  })
  assert.equal(runtime.registerPlayer('player-1', 'P1').ok, true)
  assert.equal(runtime.handleAction('player-1', { type: 'RECRUIT_BATCH', actionId: 'recruit-1' }).ok, true)
  return runtime
}

export function runPveV2SmokeChecks(): {
  deterministic: true
  economy: true
  deployment: true
  merge: true
  combat: true
} {
  assert.equal(isDefaultDeployableCell('P1', 12, 16), true)
  assert.equal(isDefaultDeployableCell('P1', 16, 16), false)
  assert.equal(isDefaultDeployableCell('P1', 13, 15), false)

  const runtime = createPreparedRuntime('smoke-combat')
  let snapshot = runtime.snapshot()
  assert.equal(snapshot.players[0].rice, 5)
  assert.equal(snapshot.players[0].nextRecruitCost, 7)
  assert.ok(snapshot.players[0].tray.some((piece) => piece?.kind === 'soldier'))
  assert.equal(
    runtime.handleAction('player-1', { type: 'RECRUIT_BATCH', actionId: 'recruit-2' }).code,
    'INSUFFICIENT_RICE',
  )
  const duplicateRecruit = runtime.handleAction('player-1', { type: 'RECRUIT_BATCH', actionId: 'recruit-1' })
  assert.equal(duplicateRecruit.ok, true)
  assert.equal(runtime.snapshot().players[0].rice, 5)

  const soldier = firstSoldier(snapshot)
  const placement = getDefaultSoldierPlacement('P1')
  assert.equal(runtime.handleAction('player-1', {
    type: 'SWAP_TRAY_BOARD',
    actionId: 'deploy-1',
    trayIndex: soldier.index,
    boardX: placement.x,
    boardY: placement.y,
  }).ok, true)
  assert.equal(runtime.snapshot().players[0].populationUsed, 1)
  assert.equal(runtime.handleAction('player-1', {
    type: 'MOVE_BOARD_PIECE',
    actionId: 'invalid-foreign-zone',
    pieceId: soldier.piece.id,
    targetX: 16,
    targetY: 16,
  }).code, 'CELL_NOT_DEPLOYABLE')

  assert.equal(runtime.start().ok, true)
  for (let tick = 0; tick < 12000 && runtime.snapshot().status !== 'finished'; tick += 1) {
    runtime.tick()
  }
  snapshot = runtime.snapshot()
  assert.equal(snapshot.result?.outcome, 'victory')
  assert.equal(snapshot.players[0].rice, 14)
  assert.deepEqual(snapshot.players[0].clearedWaves, [1])

  const mergeRuntime = new PveGameRuntime({ seed: 'smoke-merge', characterTokens: {} })
  assert.equal(mergeRuntime.registerPlayer('merge-player', 'P1').ok, true)
  assert.equal(mergeRuntime.handleAction('merge-player', { type: 'RECRUIT_BATCH', actionId: 'merge-recruit' }).ok, true)
  const mergeTray = mergeRuntime.snapshot().players[0].tray.filter((piece): piece is SoldierPiece => piece?.kind === 'soldier')
  let source: SoldierPiece | null = null
  let target: SoldierPiece | null = null
  for (let left = 0; left < mergeTray.length; left += 1) {
    for (let right = left + 1; right < mergeTray.length; right += 1) {
      if (mergeTray[left].soldierType === mergeTray[right].soldierType) {
        source = mergeTray[left]
        target = mergeTray[right]
        break
      }
    }
    if (source) {
      break
    }
  }
  assert.ok(source && target)
  assert.equal(mergeRuntime.handleAction('merge-player', {
    type: 'MERGE_SOLDIERS',
    actionId: 'merge-1',
    sourcePieceId: source.id,
    targetPieceId: target.id,
  }).ok, true)
  const mergedSnapshot = mergeRuntime.snapshot()
  assert.equal(mergedSnapshot.players[0].tray.filter(Boolean).length, 4)
  assert.ok(mergedSnapshot.players[0].tray.some((piece) => piece?.kind === 'soldier' && piece.level === 2))

  const deterministicA = createPreparedRuntime('same-seed')
  const deterministicB = createPreparedRuntime('same-seed')
  assert.deepEqual(deterministicA.snapshot(), deterministicB.snapshot())

  const forcedSoldierRuntime = new PveGameRuntime({
    seed: 'force-117588',
    characterTokens: { 杨: 100, 戬: 100, 孙: 100, 悟: 100, 空: 100 },
  })
  assert.equal(forcedSoldierRuntime.registerPlayer('forced', 'P1').ok, true)
  assert.equal(forcedSoldierRuntime.handleAction('forced', {
    type: 'RECRUIT_BATCH',
    actionId: 'forced-recruit',
  }).details?.firstBatchSoldierForced, true)
  const forcedTray = forcedSoldierRuntime.snapshot().players[0].tray
  assert.equal(forcedTray.filter((piece) => piece?.kind === 'soldier').length, 1)
  assert.equal(forcedTray.filter((piece) => piece?.kind === 'character').length, 4)

  const retirementRuntime = new PveGameRuntime({ seed: 'retirement', prepDurationMs: 0, maxWaves: 2 })
  assert.equal(retirementRuntime.registerPlayer('stay', 'P1').ok, true)
  assert.equal(retirementRuntime.registerPlayer('leave', 'P2').ok, true)
  assert.equal(retirementRuntime.start().ok, true)
  retirementRuntime.tick()
  const spawnedBeforeLeave = retirementRuntime.snapshot().wave.lanes.find((lane) => lane.playerId === 'leave')?.spawnedCount
  assert.equal(retirementRuntime.unregister('leave').ok, true)
  for (let tick = 0; tick < 30; tick += 1) {
    retirementRuntime.tick()
  }
  const retiredLane = retirementRuntime.snapshot().wave.lanes.find((lane) => lane.playerId === 'leave')
  assert.equal(retiredLane?.retired, true)
  assert.equal(retiredLane?.spawnedCount, spawnedBeforeLeave)
  assert.equal(retiredLane?.totalCount, spawnedBeforeLeave)
  assert.equal(retiredLane?.clearRewardGranted, false)

  return {
    deterministic: true,
    economy: true,
    deployment: true,
    merge: true,
    combat: true,
  }
}
