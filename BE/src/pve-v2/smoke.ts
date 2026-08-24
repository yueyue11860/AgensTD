import assert from 'node:assert/strict'
import { getDefaultSoldierPlacement, isDefaultDeployableCell, isInsidePveProtectedZoneMilli } from './arena'
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
  reserve: true
  waveTiming: true
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

  let chainRuntime: PveGameRuntime | null = null
  let chainPieces: SoldierPiece[] = []
  for (let seedIndex = 0; seedIndex < 2000 && chainPieces.length < 4; seedIndex += 1) {
    const candidate = new PveGameRuntime({ seed: `tray-chain-${seedIndex}`, characterTokens: {} })
    assert.equal(candidate.registerPlayer('chain-player', 'P1').ok, true)
    assert.equal(candidate.handleAction('chain-player', { type: 'RECRUIT_BATCH', actionId: 'chain-recruit' }).ok, true)
    const soldiers = candidate.snapshot().players[0].tray.filter(isSoldierForSmoke)
    const matching = soldiers.filter((piece) => (
      soldiers.filter((other) => other.soldierType === piece.soldierType).length >= 4
    ))
    if (matching.length >= 4) {
      chainRuntime = candidate
      chainPieces = matching.slice(0, 4)
    }
  }
  assert.ok(chainRuntime && chainPieces.length === 4)
  const chainIndexes = chainPieces.map((piece) => (
    chainRuntime!.snapshot().players[0].tray.findIndex((candidate) => candidate?.id === piece.id)
  ))
  assert.ok(chainIndexes.every((index) => index >= 0))
  assert.equal(chainRuntime.handleAction('chain-player', {
    type: 'SWAP_STORAGE_PIECES', actionId: 'chain-store-1',
    sourceZone: 'tray', sourceIndex: chainIndexes[0], targetZone: 'reserve', targetIndex: 0,
  }).ok, true)
  assert.equal(chainRuntime.handleAction('chain-player', {
    type: 'SWAP_STORAGE_PIECES', actionId: 'chain-store-2',
    sourceZone: 'tray', sourceIndex: chainIndexes[1], targetZone: 'reserve', targetIndex: 1,
  }).ok, true)
  assert.equal(chainRuntime.handleAction('chain-player', {
    type: 'MERGE_SOLDIERS', actionId: 'chain-merge-reserve',
    sourcePieceId: chainPieces[0].id, targetPieceId: chainPieces[1].id,
  }).ok, true)
  assert.equal(chainRuntime.handleAction('chain-player', {
    type: 'MERGE_SOLDIERS', actionId: 'chain-merge-tray',
    sourcePieceId: chainPieces[2].id, targetPieceId: chainPieces[3].id,
  }).ok, true)
  const chainMiddleSnapshot = chainRuntime.snapshot().players[0]
  const reserveLevelTwo = chainMiddleSnapshot.reserve.find(
    (piece): piece is SoldierPiece => piece?.kind === 'soldier' && piece.level === 2,
  )
  const trayLevelTwo = chainMiddleSnapshot.tray.find(
    (piece): piece is SoldierPiece => piece?.kind === 'soldier' && piece.level === 2,
  )
  assert.ok(reserveLevelTwo && trayLevelTwo)
  assert.equal(chainRuntime.handleAction('chain-player', {
    type: 'MERGE_SOLDIERS', actionId: 'chain-merge-cross-storage',
    sourcePieceId: reserveLevelTwo.id, targetPieceId: trayLevelTwo.id,
  }).ok, true)
  const levelThreeSlot = chainRuntime.snapshot().players[0].tray.findIndex(
    (piece) => piece?.kind === 'soldier' && piece.level === 3,
  )
  assert.ok(levelThreeSlot >= 0)
  assert.equal(chainRuntime.handleAction('chain-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'chain-deploy', trayIndex: levelThreeSlot, boardX: 9, boardY: 17,
  }).ok, true)
  assert.equal((chainRuntime.snapshot().players[0].boardPieces[0].piece as SoldierPiece).level, 3)

  const storageSwapRuntime = new PveGameRuntime({ seed: 'storage-swap', characterTokens: {} })
  assert.equal(storageSwapRuntime.registerPlayer('storage-player', 'P1').ok, true)
  assert.equal(storageSwapRuntime.handleAction('storage-player', {
    type: 'RECRUIT_BATCH', actionId: 'storage-recruit',
  }).ok, true)
  const storageInitial = storageSwapRuntime.snapshot().players[0].tray
  const storageIds = storageInitial.slice(0, 4).map((piece) => piece?.id)
  assert.ok(storageIds.every(Boolean))
  assert.equal(storageSwapRuntime.handleAction('storage-player', {
    type: 'SWAP_STORAGE_PIECES', actionId: 'storage-tray-reserve-a',
    sourceZone: 'tray', sourceIndex: 0, targetZone: 'reserve', targetIndex: 0,
  }).ok, true)
  assert.equal(storageSwapRuntime.handleAction('storage-player', {
    type: 'SWAP_STORAGE_PIECES', actionId: 'storage-tray-reserve-b',
    sourceZone: 'tray', sourceIndex: 1, targetZone: 'reserve', targetIndex: 1,
  }).ok, true)
  assert.equal(storageSwapRuntime.handleAction('storage-player', {
    type: 'SWAP_STORAGE_PIECES', actionId: 'storage-reserve-reserve',
    sourceZone: 'reserve', sourceIndex: 0, targetZone: 'reserve', targetIndex: 1,
  }).ok, true)
  assert.equal(storageSwapRuntime.handleAction('storage-player', {
    type: 'SWAP_STORAGE_PIECES', actionId: 'storage-reserve-tray-occupied',
    sourceZone: 'reserve', sourceIndex: 0, targetZone: 'tray', targetIndex: 2,
  }).ok, true)
  assert.equal(storageSwapRuntime.handleAction('storage-player', {
    type: 'SWAP_STORAGE_PIECES', actionId: 'storage-tray-tray-occupied',
    sourceZone: 'tray', sourceIndex: 2, targetZone: 'tray', targetIndex: 3,
  }).ok, true)
  const storageFinal = storageSwapRuntime.snapshot().players[0]
  assert.equal(storageFinal.populationUsed, 0)
  assert.equal(storageFinal.reserve[1]?.id, storageIds[0])
  assert.equal(storageFinal.tray[3]?.id, storageIds[1])
  assert.equal(storageFinal.tray[2]?.id, storageIds[3])

  const directMergeRuntime = new PveGameRuntime({ seed: 'direct-board-merge', characterTokens: {} })
  assert.equal(directMergeRuntime.registerPlayer('direct-player', 'P1').ok, true)
  assert.equal(directMergeRuntime.handleAction('direct-player', {
    type: 'RECRUIT_BATCH',
    actionId: 'direct-recruit',
  }).ok, true)
  const directTray = directMergeRuntime.snapshot().players[0].tray
  let directSourceIndex = -1
  let directTargetIndex = -1
  for (let left = 0; left < directTray.length; left += 1) {
    for (let right = left + 1; right < directTray.length; right += 1) {
      const leftPiece = directTray[left]
      const rightPiece = directTray[right]
      if (isSoldierForSmoke(leftPiece) && isSoldierForSmoke(rightPiece) && leftPiece.soldierType === rightPiece.soldierType) {
        directSourceIndex = left
        directTargetIndex = right
        break
      }
    }
    if (directSourceIndex >= 0) break
  }
  assert.ok(directSourceIndex >= 0 && directTargetIndex >= 0)
  const directSource = directTray[directSourceIndex] as SoldierPiece
  const directTarget = directTray[directTargetIndex] as SoldierPiece
  assert.equal(directMergeRuntime.handleAction('direct-player', {
    type: 'SWAP_TRAY_BOARD',
    actionId: 'direct-deploy-target',
    trayIndex: directTargetIndex,
    boardX: 9,
    boardY: 17,
  }).ok, true)
  assert.equal(directMergeRuntime.handleAction('direct-player', {
    type: 'MERGE_SOLDIERS',
    actionId: 'direct-merge',
    sourcePieceId: directSource.id,
    targetPieceId: directTarget.id,
  }).ok, true)
  let directSnapshot = directMergeRuntime.snapshot()
  assert.equal(directSnapshot.players[0].boardPieces.length, 1)
  assert.equal((directSnapshot.players[0].boardPieces[0].piece as SoldierPiece).level, 2)
  assert.equal(directSnapshot.players[0].populationUsed, 1)

  const swapCandidates = directSnapshot.players[0].tray
    .map((piece, index) => ({ piece, index }))
    .filter((candidate): candidate is { piece: SoldierPiece, index: number } => candidate.piece?.kind === 'soldier')
    .slice(0, 2)
  assert.equal(swapCandidates.length, 2)
  assert.equal(directMergeRuntime.handleAction('direct-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'swap-deploy-a', trayIndex: swapCandidates[0].index, boardX: 8, boardY: 17,
  }).ok, true)
  assert.equal(directMergeRuntime.handleAction('direct-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'swap-deploy-b', trayIndex: swapCandidates[1].index, boardX: 8, boardY: 16,
  }).ok, true)
  assert.equal(directMergeRuntime.handleAction('direct-player', {
    type: 'MOVE_BOARD_PIECE', actionId: 'direct-board-swap', pieceId: swapCandidates[0].piece.id, targetX: 8, targetY: 16,
  }).ok, true)
  directSnapshot = directMergeRuntime.snapshot()
  const swappedA = directSnapshot.players[0].boardPieces.find(({ piece }) => piece.id === swapCandidates[0].piece.id)
  const swappedB = directSnapshot.players[0].boardPieces.find(({ piece }) => piece.id === swapCandidates[1].piece.id)
  assert.deepEqual(swappedA && { x: swappedA.x, y: swappedA.y }, { x: 8, y: 16 })
  assert.deepEqual(swappedB && { x: swappedB.x, y: swappedB.y }, { x: 8, y: 17 })

  const reserveRuntime = new PveGameRuntime({ seed: 'reserve-flow', characterTokens: {} })
  assert.equal(reserveRuntime.registerPlayer('reserve-player', 'P1').ok, true)
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'RECRUIT_BATCH', actionId: 'reserve-recruit',
  }).ok, true)
  const reserveTray = reserveRuntime.snapshot().players[0].tray
  const reserveSoldiers = reserveTray
    .map((piece, index) => ({ piece, index }))
    .filter((candidate): candidate is { piece: SoldierPiece, index: number } => candidate.piece?.kind === 'soldier')
  assert.ok(reserveSoldiers.length >= 2)
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'reserve-deploy-a', trayIndex: reserveSoldiers[0].index, boardX: 9, boardY: 17,
  }).ok, true)
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'reserve-deploy-b', trayIndex: reserveSoldiers[1].index, boardX: 8, boardY: 17,
  }).ok, true)
  assert.equal(reserveRuntime.snapshot().players[0].populationUsed, 2)
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'SWAP_RESERVE_BOARD', actionId: 'reserve-store', reserveIndex: 0, boardX: 9, boardY: 17,
  }).ok, true)
  let reserveSnapshot = reserveRuntime.snapshot()
  assert.equal(reserveSnapshot.players[0].populationUsed, 1)
  assert.equal(reserveSnapshot.players[0].reserve[0]?.id, reserveSoldiers[0].piece.id)
  const staleReserveRevision = reserveSnapshot.players[0].reserveRevision - 1
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'SWAP_RESERVE_BOARD', actionId: 'reserve-stale', reserveIndex: 0, boardX: 8, boardY: 17,
    expectedReserveRevision: staleReserveRevision,
  }).code, 'STALE_RESERVE_REVISION')
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'SWAP_RESERVE_BOARD', actionId: 'reserve-swap', reserveIndex: 0, boardX: 8, boardY: 17,
  }).ok, true)
  reserveSnapshot = reserveRuntime.snapshot()
  assert.equal(reserveSnapshot.players[0].populationUsed, 1)
  assert.equal(reserveSnapshot.players[0].reserve[0]?.id, reserveSoldiers[1].piece.id)
  assert.equal(reserveSnapshot.players[0].boardPieces.find(({ x, y }) => x === 8 && y === 17)?.piece.id, reserveSoldiers[0].piece.id)
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'EXILE_RESERVE', actionId: 'reserve-exile', expectedReserveRevision: reserveSnapshot.players[0].reserveRevision,
  }).details?.exiledCount, 1)
  reserveSnapshot = reserveRuntime.snapshot()
  assert.deepEqual(reserveSnapshot.players[0].reserve, [null, null])
  assert.equal(reserveRuntime.handleAction('reserve-player', {
    type: 'EXILE_RESERVE', actionId: 'reserve-exile-empty', expectedReserveRevision: reserveSnapshot.players[0].reserveRevision,
  }).details?.exiledCount, 0)

  const timedWaveRuntime = new PveGameRuntime({
    seed: 'timed-overlapping-waves',
    tickRateMs: 100,
    prepDurationMs: 500,
    maxWaves: 2,
  })
  assert.equal(timedWaveRuntime.registerPlayer('timed-player', 'P1').ok, true)
  assert.equal(timedWaveRuntime.start().ok, true)
  let sawFirstWaveSpawning = false
  let reachedInterWaveCountdown = false
  for (let tick = 0; tick < 500 && !reachedInterWaveCountdown; tick += 1) {
    const timedSnapshot = timedWaveRuntime.tick()
    if (timedSnapshot.wave.number === 1 && timedSnapshot.wave.phase === 'spawning') {
      sawFirstWaveSpawning = true
    }
    reachedInterWaveCountdown = sawFirstWaveSpawning
      && timedSnapshot.wave.number === 1
      && timedSnapshot.wave.phase === 'prep'
  }
  let timedSnapshot = timedWaveRuntime.snapshot()
  assert.equal(reachedInterWaveCountdown, true)
  assert.equal(timedSnapshot.wave.prepRemainingTicks, 5)
  assert.ok(timedSnapshot.enemies.some((enemy) => enemy.waveNumber === 1))
  for (let tick = 0; tick < 4; tick += 1) timedWaveRuntime.tick()
  timedSnapshot = timedWaveRuntime.snapshot()
  assert.equal(timedSnapshot.wave.number, 1)
  assert.equal(timedSnapshot.wave.phase, 'prep')
  assert.equal(timedSnapshot.wave.prepRemainingTicks, 1)
  timedSnapshot = timedWaveRuntime.tick()
  assert.equal(timedSnapshot.wave.number, 2)
  assert.equal(timedSnapshot.wave.phase, 'spawning')
  assert.ok(timedSnapshot.enemies.some((enemy) => enemy.waveNumber === 1))
  assert.ok(timedSnapshot.enemies.some((enemy) => enemy.waveNumber === 2))

  const protectedRuntime = new PveGameRuntime({ seed: 'protected-zone', prepDurationMs: 0, maxWaves: 1 })
  assert.equal(protectedRuntime.registerPlayer('protected-player', 'P1').ok, true)
  assert.equal(protectedRuntime.handleAction('protected-player', { type: 'RECRUIT_BATCH', actionId: 'protected-recruit' }).ok, true)
  const protectedSoldier = firstSoldier(protectedRuntime.snapshot())
  assert.equal(protectedRuntime.handleAction('protected-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'protected-deploy', trayIndex: protectedSoldier.index, boardX: 9, boardY: 17,
  }).ok, true)
  assert.equal(protectedRuntime.start().ok, true)
  for (let tick = 0; tick < 55; tick += 1) protectedRuntime.tick()
  const protectedSnapshot = protectedRuntime.snapshot()
  assert.ok(protectedSnapshot.enemies.length > 0)
  assert.ok(protectedSnapshot.enemies.every((enemy) => (
    !isInsidePveProtectedZoneMilli(enemy.xMilli, enemy.yMilli) || enemy.currentHp === enemy.maxHp
  )))
  let damageAfterExit = false
  for (let tick = 0; tick < 80 && !damageAfterExit; tick += 1) {
    const next = protectedRuntime.tick()
    damageAfterExit = next.players[0].rice > 5
      || next.enemies.some((enemy) => (
        !isInsidePveProtectedZoneMilli(enemy.xMilli, enemy.yMilli) && enemy.currentHp < enemy.maxHp
      ))
  }
  assert.equal(damageAfterExit, true)

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
    reserve: true,
    waveTiming: true,
    combat: true,
  }
}

function isSoldierForSmoke(piece: PveRuntimeSnapshot['players'][number]['tray'][number]): piece is SoldierPiece {
  return piece?.kind === 'soldier'
}
