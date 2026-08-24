import assert from 'node:assert/strict'
import { PVE_MINION_GLYPHS, PVE_STAGE_DEFINITIONS } from '../../../shared/contracts/pve-stage-config'
import {
  getDefaultSoldierPlacement,
  hasEnemyBodyFullyExitedPveSpawnSquareMilli,
  isDefaultDeployableCell,
  PVE_ENEMY_BODY_RADIUS_MILLI,
} from './arena'
import { PVE_WAVE_PREP_DURATION_MS, PveGameRuntime } from './runtime'
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
  hero: true
  waveTiming: true
  combat: true
} {
  assert.equal(isDefaultDeployableCell('P1', 12, 16), true)
  assert.equal(isDefaultDeployableCell('P1', 17, 19), true)
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
    actionId: 'cross-territory-deploy',
    trayIndex: soldier.index,
    boardX: 17,
    boardY: 19,
  }).ok, true)
  assert.equal(runtime.snapshot().players[0].populationUsed, 1)
  assert.equal(runtime.handleAction('player-1', {
    type: 'MOVE_BOARD_PIECE',
    actionId: 'move-to-home-side',
    pieceId: soldier.piece.id,
    targetX: placement.x,
    targetY: placement.y,
  }).ok, true)
  assert.equal(runtime.handleAction('player-1', {
    type: 'MOVE_BOARD_PIECE',
    actionId: 'invalid-core-cell',
    pieceId: soldier.piece.id,
    targetX: 13,
    targetY: 15,
  }).code, 'CELL_NOT_DEPLOYABLE')
  assert.equal(runtime.start().ok, true)
  for (let tick = 0; tick < 12000 && runtime.snapshot().status !== 'finished'; tick += 1) {
    runtime.tick()
  }
  snapshot = runtime.snapshot()
  assert.equal(snapshot.result?.outcome, 'victory')
  assert.equal(snapshot.players[0].rice, 20)
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

  let houyiRuntime: PveGameRuntime | null = null
  for (let seedIndex = 0; seedIndex < 5000 && !houyiRuntime; seedIndex += 1) {
    const candidate = new PveGameRuntime({
      seed: `houyi-integration-${seedIndex}`,
      prepDurationMs: 0,
      maxWaves: 1,
      characterTokens: { 后: 1, 羿: 1 },
    })
    candidate.registerPlayer('houyi-player', 'P1')
    candidate.handleAction('houyi-player', { type: 'RECRUIT_BATCH', actionId: 'houyi-recruit' })
    const glyphs = candidate.snapshot().players[0].tray.flatMap((piece) => (
      piece?.kind === 'character' ? [piece.glyph] : []
    ))
    if (glyphs.includes('后') && glyphs.includes('羿')) houyiRuntime = candidate
  }
  assert.ok(houyiRuntime, 'A deterministic seed should recruit both Houyi glyphs in the first batch')
  const houyiTray = houyiRuntime.snapshot().players[0].tray
  const houIndex = houyiTray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === '后')
  const yiIndex = houyiTray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === '羿')
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'deploy-hou', trayIndex: houIndex, boardX: 11, boardY: 17,
  }).ok, true)
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'deploy-yi', trayIndex: yiIndex, boardX: 12, boardY: 17,
  }).ok, true)
  let houyiSnapshot = houyiRuntime.snapshot()
  assert.equal(houyiSnapshot.players[0].populationUsed, 1)
  assert.equal(houyiSnapshot.players[0].generalFormations[0]?.generalId, 'houyi')
  assert.equal(houyiSnapshot.players[0].generalProgress[0]?.attack, 34)
  assert.equal(houyiSnapshot.players[0].generalProgress[0]?.attackRangeMilliCells, 3000)
  const firstFormationId = houyiSnapshot.players[0].generalFormations[0]?.formationId
  assert.ok(firstFormationId)
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'SET_GENERAL_FIXED', actionId: 'fix-houyi', formationId: firstFormationId, fixed: true,
  }).ok, true)
  const yiPieceId = houyiSnapshot.players[0].boardPieces.find(({ piece }) => (
    piece.kind === 'character' && piece.glyph === '羿'
  ))?.piece.id
  assert.ok(yiPieceId)
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'MOVE_BOARD_PIECE', actionId: 'fixed-single-move-rejected', pieceId: yiPieceId, targetX: 8, targetY: 17,
  }).code, 'GENERAL_FIXED')
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'MOVE_FIXED_GENERAL', actionId: 'move-fixed-houyi', formationId: firstFormationId,
    targetStartX: 10, targetStartY: 17,
  }).ok, true)
  assert.equal(houyiRuntime.start().ok, true)
  for (let tick = 0; tick < 150; tick += 1) {
    houyiRuntime.tick()
    if ((houyiRuntime.snapshot().players[0].generalProgress[0]?.experiencePoints ?? 0) > 0) break
  }
  houyiSnapshot = houyiRuntime.snapshot()
  const experienceBeforeDisband = houyiSnapshot.players[0].generalProgress[0]?.experiencePoints ?? 0
  assert.ok(experienceBeforeDisband > 0, 'Houyi should deal a killing contribution and receive experience')
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'SET_GENERAL_FIXED', actionId: 'unfix-houyi', formationId: firstFormationId, fixed: false,
  }).ok, true)
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'MOVE_BOARD_PIECE', actionId: 'disband-houyi', pieceId: yiPieceId, targetX: 8, targetY: 17,
  }).ok, true)
  houyiSnapshot = houyiRuntime.snapshot()
  assert.equal(houyiSnapshot.players[0].generalFormations.length, 0)
  assert.equal(houyiSnapshot.players[0].populationUsed, 0)
  assert.equal(houyiSnapshot.players[0].generalProgress[0]?.experiencePoints, experienceBeforeDisband)
  assert.equal(houyiRuntime.handleAction('houyi-player', {
    type: 'MOVE_BOARD_PIECE', actionId: 'reform-houyi', pieceId: yiPieceId, targetX: 11, targetY: 17,
  }).ok, true)
  houyiSnapshot = houyiRuntime.snapshot()
  assert.equal(houyiSnapshot.players[0].generalFormations[0]?.generalId, 'houyi')
  assert.equal(houyiSnapshot.players[0].generalProgress[0]?.experiencePoints, experienceBeforeDisband)

  const firstWavePrepRuntime = new PveGameRuntime({
    seed: 'first-wave-five-second-prep',
    tickRateMs: 100,
    maxWaves: 1,
  })
  assert.equal(firstWavePrepRuntime.registerPlayer('first-wave-player', 'P1').ok, true)
  assert.equal(firstWavePrepRuntime.start().ok, true)
  let firstWavePrepSnapshot = firstWavePrepRuntime.snapshot()
  assert.equal(firstWavePrepSnapshot.wave.number, 1)
  assert.equal(firstWavePrepSnapshot.wave.phase, 'prep')
  assert.equal(firstWavePrepSnapshot.wave.prepRemainingTicks, PVE_WAVE_PREP_DURATION_MS / 100)
  assert.equal(firstWavePrepSnapshot.enemies.length, 0)
  for (let tick = 0; tick < (PVE_WAVE_PREP_DURATION_MS / 100) - 1; tick += 1) {
    firstWavePrepSnapshot = firstWavePrepRuntime.tick()
    assert.equal(firstWavePrepSnapshot.enemies.length, 0)
  }
  assert.equal(firstWavePrepSnapshot.wave.phase, 'prep')
  assert.equal(firstWavePrepSnapshot.wave.prepRemainingTicks, 1)
  firstWavePrepSnapshot = firstWavePrepRuntime.tick()
  assert.equal(firstWavePrepSnapshot.wave.phase, 'spawning')
  assert.equal(firstWavePrepSnapshot.enemies.length, 1)
  assert.equal(
    firstWavePrepSnapshot.recentEvents.find((event) => event.type === 'ENEMY_SPAWNED')?.tick,
    PVE_WAVE_PREP_DURATION_MS / 100,
  )

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

  // 出生方格真实边界是 12.5～15.5；半径 0.406 的身体后缘必须严格越线。
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(12094, 14000), false)
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(12093, 14000), true)
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(15906, 14000), false)
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(15907, 14000), true)
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(14000, 12094), false)
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(14000, 12093), true)
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(14000, 15906), false)
  assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(14000, 15907), true)
  assert.equal(PVE_ENEMY_BODY_RADIUS_MILLI, 406)

  assert.equal(PVE_STAGE_DEFINITIONS.length, 10)
  assert.deepEqual(PVE_STAGE_DEFINITIONS.map(({ levelId }) => levelId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  const configuredMinionGlyphs = new Set<string>()
  for (const stageDefinition of PVE_STAGE_DEFINITIONS) {
    assert.ok(stageDefinition.minionGlyphs.length >= 1 && stageDefinition.minionGlyphs.length <= 4)
    assert.equal(new Set(stageDefinition.minionGlyphs).size, stageDefinition.minionGlyphs.length)
    assert.equal(stageDefinition.waveGlyphPools.length, 20)
    for (const glyph of stageDefinition.minionGlyphs) configuredMinionGlyphs.add(glyph)
    for (const pool of stageDefinition.waveGlyphPools) {
      assert.ok(pool.length >= 1 && pool.length <= 4)
      assert.ok(pool.every((glyph) => stageDefinition.minionGlyphs.includes(glyph)))
    }
  }
  assert.deepEqual([...configuredMinionGlyphs].sort(), [...PVE_MINION_GLYPHS].sort())

  const webbedHollow = PVE_STAGE_DEFINITIONS.find(({ levelId }) => levelId === 7)
  assert.ok(webbedHollow)
  const themedRuntime = new PveGameRuntime({
    seed: 'stage-glyph-pool',
    prepDurationMs: 0,
    maxWaves: 1,
    waveGlyphPools: webbedHollow.waveGlyphPools,
  })
  assert.equal(themedRuntime.registerPlayer('themed-player', 'P1').ok, true)
  assert.equal(themedRuntime.start().ok, true)
  themedRuntime.tick()
  assert.ok(themedRuntime.snapshot().enemies.length > 0)
  assert.ok(themedRuntime.snapshot().enemies.every((enemy) => enemy.glyph === '蛛'))

  const fourLaneSpawnRuntime = new PveGameRuntime({
    seed: 'four-lane-body-exit',
    prepDurationMs: 0,
    maxWaves: 1,
  })
  for (const slot of ['P1', 'P2', 'P3', 'P4'] as const) {
    assert.equal(fourLaneSpawnRuntime.registerPlayer(`spawn-${slot}`, slot).ok, true)
  }
  assert.equal(fourLaneSpawnRuntime.start().ok, true)
  const fourLaneSpawnSnapshot = fourLaneSpawnRuntime.tick()
  assert.equal(fourLaneSpawnSnapshot.enemies.length, 4)
  assert.ok(fourLaneSpawnSnapshot.enemies.every((enemy) => (
    enemy.spawnProtected === true && enemy.invulnerable === false
  )))
  let fourLaneExitSnapshot = fourLaneSpawnSnapshot
  let enteredSlots = new Set<string>()
  for (let tick = 0; tick < 30 && enteredSlots.size < 4; tick += 1) {
    fourLaneExitSnapshot = fourLaneSpawnRuntime.tick()
    const enteredEvents = fourLaneExitSnapshot.recentEvents.filter((event) => (
      event.type === 'ENEMY_ENTERED_BATTLEFIELD'
    ))
    enteredSlots = new Set(enteredEvents.map((event) => String(event.data.laneSlot)))
    for (const event of enteredEvents) {
      assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(
        Number(event.data.xMilli),
        Number(event.data.yMilli),
      ), true)
    }
  }
  assert.deepEqual([...enteredSlots].sort(), ['P1', 'P2', 'P3', 'P4'])

  const bodyExitRuntime = new PveGameRuntime({ seed: 'body-exit-targeting', prepDurationMs: 0, maxWaves: 1 })
  assert.equal(bodyExitRuntime.registerPlayer('target-player', 'P1').ok, true)
  assert.equal(bodyExitRuntime.handleAction('target-player', { type: 'RECRUIT_BATCH', actionId: 'target-recruit' }).ok, true)
  const targetSoldier = firstSoldier(bodyExitRuntime.snapshot())
  assert.equal(bodyExitRuntime.handleAction('target-player', {
    type: 'SWAP_TRAY_BOARD', actionId: 'target-deploy', trayIndex: targetSoldier.index, boardX: 12, boardY: 16,
  }).ok, true)
  assert.equal(bodyExitRuntime.start().ok, true)
  let enteredBattlefieldEvent: PveRuntimeSnapshot['recentEvents'][number] | undefined
  let firstDamageEvent: PveRuntimeSnapshot['recentEvents'][number] | undefined
  for (let tick = 0; tick < 40 && !firstDamageEvent; tick += 1) {
    const next = bodyExitRuntime.tick()
    for (const enemy of next.enemies.filter((candidate) => candidate.spawnProtected)) {
      assert.equal(enemy.currentHp, enemy.maxHp)
      assert.equal(hasEnemyBodyFullyExitedPveSpawnSquareMilli(enemy.xMilli, enemy.yMilli), false)
    }
    enteredBattlefieldEvent ??= next.recentEvents.find((event) => (
      event.type === 'ENEMY_ENTERED_BATTLEFIELD'
    ))
    firstDamageEvent = next.recentEvents.find((event) => event.type === 'DAMAGE_APPLIED')
  }
  assert.ok(enteredBattlefieldEvent)
  assert.ok(firstDamageEvent)
  assert.ok(firstDamageEvent.tick >= enteredBattlefieldEvent.tick)

  // 即使固定间隔已到，只要上一只仍在出生方格内，同一路线就不能生成下一只。
  // 自定义路线故意让第一只在中央方格内绕行超过第一波的 2.5 秒固定间隔。
  const spawnGateRuntime = new PveGameRuntime({
    seed: 'per-lane-spawn-gate',
    prepDurationMs: 0,
    maxWaves: 1,
    eventHistoryLimit: 500,
    laneRoutes: {
      P1: {
        waypoints: [
          { x: 13, y: 15 },
          { x: 15, y: 15 },
          { x: 15, y: 13 },
          { x: 10, y: 13 },
          { x: 10, y: 7 },
          { x: 7, y: 7 },
        ],
        loopStartIndex: 3,
      },
    },
  })
  assert.equal(spawnGateRuntime.registerPlayer('gate-player', 'P1').ok, true)
  assert.equal(spawnGateRuntime.start().ok, true)
  for (let tick = 0; tick < 30; tick += 1) spawnGateRuntime.tick()
  let spawnGateSnapshot = spawnGateRuntime.snapshot()
  assert.equal(spawnGateSnapshot.recentEvents.filter((event) => event.type === 'ENEMY_SPAWNED').length, 1)
  assert.equal(spawnGateSnapshot.enemies[0]?.spawnProtected, true)

  let secondSpawnEvent: PveRuntimeSnapshot['recentEvents'][number] | undefined
  for (let tick = 0; tick < 70 && !secondSpawnEvent; tick += 1) {
    spawnGateSnapshot = spawnGateRuntime.tick()
    const spawnEvents = spawnGateSnapshot.recentEvents.filter((event) => event.type === 'ENEMY_SPAWNED')
    secondSpawnEvent = spawnEvents[1]
  }
  const firstExitEvent = spawnGateSnapshot.recentEvents.find((event) => (
    event.type === 'ENEMY_ENTERED_BATTLEFIELD'
  ))
  assert.ok(firstExitEvent)
  assert.ok(secondSpawnEvent)
  assert.ok(secondSpawnEvent.tick > firstExitEvent.tick)

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
    hero: true,
    waveTiming: true,
    combat: true,
  }
}

function isSoldierForSmoke(piece: PveRuntimeSnapshot['players'][number]['tray'][number]): piece is SoldierPiece {
  return piece?.kind === 'soldier'
}
