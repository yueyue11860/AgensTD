import assert from 'node:assert/strict'
import {
  DUAL_REALM_MAP,
  PVP_A_ROUTE_ANCHORS,
  PVP_B_ROUTE_ANCHORS,
  compileDualRealmMap,
  hasEnemyBodyFullyExitedPvpSpawnGate,
  isPvpDeployableCell,
  mirrorPvpPosition,
} from './map'
import { PvpMatchRuntime } from './runtime'

function readyRuntime(matchId: string, seed = `seed:${matchId}`): PvpMatchRuntime {
  const runtime = new PvpMatchRuntime({
    matchId,
    mode: 'ranked_1v1',
    seed,
    rulesetVersion: 'pvp-rules-v1',
    tickRateMs: 100,
    countdownMs: 5000,
    roundIntervalMs: 20_000,
    eventHistoryLimit: 2000,
  })
  assert.equal(runtime.registerParticipant('A', { playerId: `${matchId}:a`, playerName: '甲' }).ok, true)
  assert.equal(runtime.registerParticipant('B', { playerId: `${matchId}:b`, playerName: '乙' }).ok, true)
  assert.equal(runtime.snapshot().phase, 'ready_check')
  assert.equal(runtime.setReady(`${matchId}:a`).ok, true)
  assert.equal(runtime.setReady(`${matchId}:b`).ok, true)
  assert.equal(runtime.snapshot().phase, 'loading')
  assert.equal(runtime.markLoaded(`${matchId}:a`).ok, true)
  assert.equal(runtime.markLoaded(`${matchId}:b`).ok, true)
  assert.equal(runtime.snapshot().phase, 'countdown')
  return runtime
}

function validateRecruitDeployMergeAndAutoCombat(): void {
  const runtime = readyRuntime('vertical-playable')
  advanceToPlaying(runtime)
  const playerA = 'vertical-playable:a'
  const playerB = 'vertical-playable:b'
  const recruited: string[] = []
  for (let index = 0; index < 5; index += 1) {
    const before = runtime.snapshot().sides.A!
    const result = runtime.recruit(playerA, { requestId: `recruit-${index}`, expectedTrayRevision: before.privateState.trayRevision })
    assert.equal(result.ok, true)
    recruited.push(String(result.details?.unitId))
    if (index === 0) {
      const duplicate = runtime.recruit(playerA, { requestId: 'recruit-0', expectedTrayRevision: 0 })
      assert.equal(duplicate.duplicate, true)
      assert.equal(runtime.snapshot().sides.A?.stats.paidRecruitCount, 1)
    }
  }
  assert.equal(runtime.snapshot().sides.A?.rations, 0)
  const noMoney = runtime.recruit(playerA, { requestId: 'recruit-no-money', expectedTrayRevision: 5 })
  assert.equal(noMoney.code, 'INSUFFICIENT_RATIONS')

  const slots = runtime.snapshot().rulesSnapshot.deploymentSlots.A
  assert.equal(runtime.deploy(playerA, { requestId: 'deploy-oob', unitId: recruited[0]!, x: 14, y: 1, expectedTrayRevision: 5, expectedBoardRevision: 0 }).code, 'CELL_NOT_DEPLOYABLE')
  assert.equal(runtime.deploy(playerB, { requestId: 'steal-unit', unitId: recruited[0]!, ...runtime.snapshot().rulesSnapshot.deploymentSlots.B[0]!, expectedTrayRevision: 0, expectedBoardRevision: 0 }).code, 'UNIT_NOT_IN_PRIVATE_STORAGE')
  for (const [index, unitId] of recruited.entries()) {
    const state = runtime.snapshot().sides.A!
    const deployed = runtime.deploy(playerA, { requestId: `deploy-${index}`, unitId, ...slots[index]!, expectedTrayRevision: state.privateState.trayRevision, expectedBoardRevision: state.privateState.boardRevision })
    assert.equal(deployed.ok, true)
  }
  for (let index = 0; index < 5; index += 1) {
    let stateB = runtime.snapshot().sides.B!
    const recruitedB = runtime.recruit(playerB, { requestId: `recruit-b-${index}`, expectedTrayRevision: stateB.privateState.trayRevision })
    assert.equal(recruitedB.ok, true)
    stateB = runtime.snapshot().sides.B!
    assert.equal(runtime.deploy(playerB, {
      requestId: `deploy-b-${index}`, unitId: String(recruitedB.details?.unitId), ...runtime.snapshot().rulesSnapshot.deploymentSlots.B[index]!,
      expectedTrayRevision: stateB.privateState.trayRevision, expectedBoardRevision: stateB.privateState.boardRevision,
    }).ok, true)
  }
  const deployedState = runtime.snapshot().sides.A!
  assert.equal(deployedState.populationUsed, 5)
  assert.equal(deployedState.boardPieces.length, 5)
  assert.equal(runtime.projectForViewer(playerB).sides.A?.privateState, null)
  assert.equal(runtime.projectForViewer(playerB).sides.A?.boardPieces.length, 5)
  assert.equal(runtime.projectForViewer(playerB).recentEvents.some((event) => event.type === 'PIECE_RECRUITED' && event.data.playerId === playerA), false)

  const sameType = deployedState.boardPieces.find((piece, index, pieces) => pieces.some((candidate, candidateIndex) => candidateIndex !== index && candidate.soldierType === piece.soldierType))!
  const mergeTarget = deployedState.boardPieces.find((piece) => piece.entityId !== sameType.entityId && piece.soldierType === sameType.soldierType)!
  const merged = runtime.moveOrMerge(playerA, {
    requestId: 'merge-1', entityId: sameType.entityId, x: mergeTarget.x, y: mergeTarget.y,
    expectedBoardRevision: deployedState.privateState.boardRevision,
  })
  assert.equal(merged.code, 'PIECE_MERGED')
  assert.equal(runtime.snapshot().sides.A?.populationUsed, 4)
  assert.equal(runtime.snapshot().sides.A?.stats.highestSoldierLevel, 2)
  assert.equal(runtime.moveOrMerge(playerB, { requestId: 'opponent-move', entityId: mergeTarget.entityId, ...runtime.snapshot().rulesSnapshot.deploymentSlots.B[1]!, expectedBoardRevision: runtime.snapshot().sides.B!.privateState.boardRevision }).code, 'PIECE_NOT_OWNED')
  assert.equal(runtime.moveOrMerge(playerA, { requestId: 'stale-move', entityId: mergeTarget.entityId, ...slots[7]!, expectedBoardRevision: 5 }).code, 'BOARD_REVISION_CONFLICT')

  for (let guard = 0; guard < 800 && runtime.snapshot().sides.A!.stats.baseKills === 0 && runtime.snapshot().phase === 'playing'; guard += 1) runtime.tick()
  const combatState = runtime.snapshot()
  assert.ok(combatState.sides.A!.stats.damageDealt > 0)
  assert.ok(combatState.sides.A!.stats.baseKills > 0)
  assert.equal(combatState.recentEvents.some((event) => event.type === 'PIECE_ATTACKED'), true)
  assert.equal(combatState.recentEvents.some((event) => event.type === 'ENEMY_KILLED'), true)

  for (let guard = 0; guard < 5_000 && runtime.snapshot().sides.A!.rations < 21 && runtime.snapshot().phase === 'playing'; guard += 1) runtime.tick()
  assert.equal(runtime.snapshot().phase, 'playing')
  for (let index = 0; index < 6; index += 1) {
    let stateA = runtime.snapshot().sides.A!
    const additional = runtime.recruit(playerA, { requestId: `cap-recruit-${index}`, expectedTrayRevision: stateA.privateState.trayRevision })
    assert.equal(additional.ok, true)
    stateA = runtime.snapshot().sides.A!
    const empty = runtime.snapshot().rulesSnapshot.deploymentSlots.A.find((slot) => !stateA.boardPieces.some((piece) => piece.x === slot.x && piece.y === slot.y))!
    assert.equal(runtime.deploy(playerA, { requestId: `cap-deploy-${index}`, unitId: String(additional.details?.unitId), ...empty, expectedTrayRevision: stateA.privateState.trayRevision, expectedBoardRevision: stateA.privateState.boardRevision }).ok, true)
  }
  assert.equal(runtime.snapshot().sides.A?.populationUsed, 10)
  let stateAtCap = runtime.snapshot().sides.A!
  while (stateAtCap.rations < 3 && runtime.snapshot().phase === 'playing') { runtime.tick(); stateAtCap = runtime.snapshot().sides.A! }
  const overflow = runtime.recruit(playerA, { requestId: 'cap-overflow-recruit', expectedTrayRevision: stateAtCap.privateState.trayRevision })
  assert.equal(overflow.ok, true)
  stateAtCap = runtime.snapshot().sides.A!
  assert.equal(runtime.deploy(playerA, { requestId: 'cap-overflow-deploy', unitId: String(overflow.details?.unitId), ...runtime.snapshot().rulesSnapshot.deploymentSlots.A[0]!, expectedTrayRevision: stateAtCap.privateState.trayRevision, expectedBoardRevision: stateAtCap.privateState.boardRevision }).code, 'POPULATION_CAP_REACHED')
}

function validateDeterministicLoanerDraft(): void {
  const first = readyRuntime('determinism-one', 'same-loaner-seed')
  const second = readyRuntime('determinism-two', 'same-loaner-seed')
  advanceToPlaying(first)
  advanceToPlaying(second)
  const draw = (runtime: PvpMatchRuntime, playerId: string) => Array.from({ length: 5 }, (_, index) => {
    const revision = runtime.snapshot().sides.A!.privateState.trayRevision
    return runtime.recruit(playerId, { requestId: `same-${index}`, expectedTrayRevision: revision }).details?.soldierType
  })
  assert.deepEqual(draw(first, 'determinism-one:a'), draw(second, 'determinism-two:a'))
}

function advanceToPlaying(runtime: PvpMatchRuntime): void {
  for (let index = 0; index < 49; index += 1) runtime.tick()
  assert.equal(runtime.snapshot().phase, 'countdown')
  assert.equal(runtime.snapshot().sides.A?.enemies.length, 0)
  runtime.tick()
  assert.equal(runtime.snapshot().phase, 'playing')
  assert.equal(runtime.snapshot().round.number, 1)
  assert.equal(runtime.snapshot().sides.A?.rations, 15)
  assert.equal(runtime.snapshot().sides.B?.rations, 15)
}

function validateMap(): void {
  assert.equal(DUAL_REALM_MAP.width, 29)
  assert.equal(DUAL_REALM_MAP.height, 29)
  assert.equal(DUAL_REALM_MAP.cells.length, 29 * 29)
  assert.equal(DUAL_REALM_MAP.routeHash.length, 64)
  assert.equal(compileDualRealmMap().routeHash, DUAL_REALM_MAP.routeHash)
  assert.deepEqual(PVP_B_ROUTE_ANCHORS, PVP_A_ROUTE_ANCHORS.map(mirrorPvpPosition))
  assert.deepEqual(
    DUAL_REALM_MAP.sides.B.routeCells,
    DUAL_REALM_MAP.sides.A.routeCells.map(mirrorPvpPosition),
  )
  assert.deepEqual(DUAL_REALM_MAP.sides.A.routeCells[0], { x: 14, y: 1 })
  assert.deepEqual(DUAL_REALM_MAP.sides.A.routeCells.at(-1), { x: 14, y: 12 })
  assert.deepEqual(DUAL_REALM_MAP.sides.B.routeCells[0], { x: 14, y: 27 })
  assert.deepEqual(DUAL_REALM_MAP.sides.B.routeCells.at(-1), { x: 14, y: 16 })
  assert.equal(isPvpDeployableCell('A', 0, 0), true)
  assert.equal(isPvpDeployableCell('A', 14, 1), false)
  assert.equal(isPvpDeployableCell('A', 0, 15), false)
  assert.equal(isPvpDeployableCell('B', 0, 28), true)
  assert.equal(isPvpDeployableCell('B', 14, 27), false)
  assert.equal(DUAL_REALM_MAP.cells.filter((cell) => cell.y === 14).every((cell) => cell.kind === 'neutral_boundary'), true)

  assert.equal(hasEnemyBodyFullyExitedPvpSpawnGate('A', 14_000, 2_900), false)
  assert.equal(hasEnemyBodyFullyExitedPvpSpawnGate('A', 14_000, 2_907), true)
  assert.equal(hasEnemyBodyFullyExitedPvpSpawnGate('B', 14_000, 25_100), false)
  assert.equal(hasEnemyBodyFullyExitedPvpSpawnGate('B', 14_000, 25_093), true)
}

function validateRoundsPressureAndProjection(): void {
  const runtime = readyRuntime('pressure')
  advanceToPlaying(runtime)
  runtime.tick()
  let state = runtime.snapshot()
  assert.equal(state.sides.A?.enemies.length, 1)
  assert.equal(state.sides.B?.enemies.length, 1)
  assert.equal(state.sides.A?.enemies[0]?.spawnProtected, true)

  let killed = 0
  for (let guard = 0; guard < 400 && killed < 5; guard += 1) {
    state = runtime.tick()
    const target = state.sides.A?.enemies.find((enemy) => !enemy.spawnProtected)
    if (!target) continue
    const result = runtime.applyAuthoritativeDamage({
      eventId: `combat-event-${killed}`,
      sourcePlayerId: 'pressure:a',
      enemyId: target.enemyId,
      rawDamage: target.hp,
      resolvedDamage: target.hp,
    })
    assert.equal(result.ok, true)
    const replay = runtime.applyAuthoritativeDamage({
      eventId: `combat-event-${killed}`,
      sourcePlayerId: 'pressure:a',
      enemyId: target.enemyId,
      rawDamage: target.hp,
      resolvedDamage: target.hp,
    })
    assert.equal(replay.ok, true)
    assert.equal(replay.duplicate, true)
    killed += 1
  }
  assert.equal(killed, 5)
  state = runtime.snapshot()
  assert.equal(state.sides.A?.scripture, 5)
  assert.equal(state.sides.A?.stats.scriptureEarned, 5)

  const pressure = runtime.sendPressure('pressure:a', 'send-pressure-1')
  assert.equal(pressure.ok, true)
  assert.equal(runtime.snapshot().sides.A?.scripture, 0)
  assert.equal(runtime.snapshot().sides.B?.privateState.pendingPressure.length, 1)
  const replay = runtime.sendPressure('pressure:a', 'send-pressure-1')
  assert.equal(replay.ok, true)
  assert.equal(replay.duplicate, true)
  assert.equal(runtime.snapshot().sides.B?.privateState.pendingPressure.length, 1)
  const conflict = runtime.surrender('pressure:a', 'send-pressure-1')
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'REQUEST_ID_CONFLICT')

  const ownView = runtime.projectForViewer('pressure:a')
  assert.ok(ownView.sides.A?.privateState)
  assert.equal(typeof ownView.sides.A?.rations, 'number')
  assert.equal(ownView.sides.B?.privateState, null)
  assert.equal(ownView.sides.B?.rations, null)
  assert.equal(Object.prototype.hasOwnProperty.call(ownView, 'seed'), false)
  const defenderView = runtime.projectForViewer('pressure:b')
  assert.equal(defenderView.sides.B?.privateState?.pendingPressure.length, 0)
  assert.equal(defenderView.recentEvents.some((event) => event.type === 'PRESSURE_QUEUED'), false)
  assert.equal(ownView.recentEvents.some((event) => event.type === 'PRESSURE_QUEUED'), true)
  assert.equal(runtime.projectForViewer(null).recentEvents.some((event) => event.type === 'PRESSURE_QUEUED'), false)

  const tickAtRoundOne = runtime.snapshot().tick
  const nextRoundAt = runtime.snapshot().round.nextRoundAtTick!
  for (let tick = tickAtRoundOne; tick < nextRoundAt; tick += 1) runtime.tick()
  assert.equal(runtime.snapshot().round.number, 2)
}

function validateTerminalReasons(): void {
  const coreDestroyed = readyRuntime('core-destroyed')
  advanceToPlaying(coreDestroyed)
  for (let guard = 0; guard < 2500 && coreDestroyed.snapshot().phase === 'playing'; guard += 1) {
    const state = coreDestroyed.tick()
    for (const enemy of state.sides.A?.enemies.filter((candidate) => !candidate.spawnProtected) ?? []) {
      coreDestroyed.applyAuthoritativeDamage({
        eventId: `core-defense-${guard}-${enemy.enemyId}`,
        sourcePlayerId: 'core-destroyed:a',
        enemyId: enemy.enemyId,
        rawDamage: enemy.hp,
        resolvedDamage: enemy.hp,
      })
    }
  }
  assert.equal(coreDestroyed.snapshot().result?.reason, 'core_destroyed')
  assert.equal(coreDestroyed.snapshot().result?.winnerPlayerId, 'core-destroyed:a')

  const surrender = readyRuntime('surrender')
  advanceToPlaying(surrender)
  const first = surrender.surrender('surrender:a', 'surrender-request')
  assert.equal(first.ok, true)
  assert.equal(surrender.snapshot().phase, 'settling')
  assert.equal(surrender.snapshot().result?.reason, 'surrendered')
  assert.equal(surrender.snapshot().result?.winnerPlayerId, 'surrender:b')
  assert.equal(surrender.snapshot().recentEvents.filter((event) => event.type === 'PVP_MATCH_FINISHED').length, 1)
  assert.equal(surrender.completeSettlement().ok, true)
  assert.equal(surrender.snapshot().phase, 'completed')

  const disconnect = readyRuntime('disconnect')
  advanceToPlaying(disconnect)
  assert.equal(disconnect.markDisconnected('disconnect:a').ok, true)
  for (let index = 0; index < 599; index += 1) disconnect.tick()
  assert.equal(disconnect.snapshot().phase, 'playing')
  disconnect.tick()
  assert.equal(disconnect.snapshot().result?.reason, 'disconnect_forfeit')
  assert.equal(disconnect.snapshot().result?.winnerPlayerId, 'disconnect:b')

  const dualDisconnect = readyRuntime('dual-disconnect')
  advanceToPlaying(dualDisconnect)
  dualDisconnect.markDisconnected('dual-disconnect:a')
  for (let index = 0; index < 10; index += 1) dualDisconnect.tick()
  dualDisconnect.markDisconnected('dual-disconnect:b')
  for (let index = 0; index < 590; index += 1) dualDisconnect.tick()
  assert.equal(dualDisconnect.snapshot().phase, 'playing', 'TCP close ordering must not award a race winner')
  for (let index = 0; index < 10; index += 1) dualDisconnect.tick()
  assert.equal(dualDisconnect.snapshot().result?.reason, 'simultaneous_draw')

  const simultaneous = readyRuntime('simultaneous')
  advanceToPlaying(simultaneous)
  for (let guard = 0; guard < 3000 && simultaneous.snapshot().phase === 'playing'; guard += 1) simultaneous.tick()
  assert.equal(simultaneous.snapshot().result?.reason, 'simultaneous_draw')
  assert.deepEqual(simultaneous.snapshot().result?.participants, { A: 'draw', B: 'draw' })

  const voided = readyRuntime('voided')
  assert.equal(voided.voidMatch('ruleset_invalid').ok, true)
  assert.equal(voided.snapshot().phase, 'voided')
  assert.equal(voided.snapshot().result?.participants.A, 'void')

  const hardTimeout = new PvpMatchRuntime({
    matchId: 'hard-timeout', mode: 'ranked_1v1', seed: 'hard-timeout', rulesetVersion: 'pvp-rules-v1',
    tickRateMs: 1000, countdownMs: 0, eventHistoryLimit: 50,
  })
  hardTimeout.registerParticipant('A', { playerId: 'hard:a', playerName: '甲' })
  hardTimeout.registerParticipant('B', { playerId: 'hard:b', playerName: '乙' })
  hardTimeout.setReady('hard:a'); hardTimeout.setReady('hard:b')
  hardTimeout.markLoaded('hard:a'); hardTimeout.markLoaded('hard:b')
  assert.equal(hardTimeout.snapshot().phase, 'playing')
  for (let index = 0; index < 720 && hardTimeout.snapshot().phase === 'playing'; index += 1) {
    const state = hardTimeout.tick()
    for (const side of ['A', 'B'] as const) {
      for (const enemy of state.sides[side]?.enemies.filter((candidate) => !candidate.spawnProtected) ?? []) {
        hardTimeout.applyAuthoritativeDamage({
          eventId: `hard-defense-${index}-${enemy.enemyId}`,
          sourcePlayerId: `hard:${side.toLowerCase()}`,
          enemyId: enemy.enemyId,
          rawDamage: enemy.hp,
          resolvedDamage: enemy.hp,
        })
      }
    }
  }
  assert.equal(hardTimeout.snapshot().result?.reason, 'hard_timeout')
  assert.deepEqual(hardTimeout.snapshot().result?.participants, { A: 'draw', B: 'draw' })
}

function validateHumanLoadAcks(): void {
  const runtime = new PvpMatchRuntime({ matchId: 'load-ack', mode: 'ranked_1v1', seed: 'load-ack', rulesetVersion: 'pvp-rules-v1', tickRateMs: 100, countdownMs: 0, loadTimeoutMs: 1000 })
  runtime.registerParticipant('A', { playerId: 'load:a', playerName: '甲' }, true)
  runtime.registerParticipant('B', { playerId: 'load:b', playerName: '乙' }, true)
  assert.equal(runtime.snapshot().phase, 'loading')
  const ack = (playerId: string, requestId: string, status: 'loaded' | 'failed' = 'loaded', rulesetVersion = 'pvp-rules-v1') => runtime.acknowledgeLoad(playerId, {
    requestId, rulesetVersion, mapId: DUAL_REALM_MAP.mapId, mapVersion: DUAL_REALM_MAP.mapVersion,
    routeHash: DUAL_REALM_MAP.routeHash, assetsVersion: 'pvp_assets_v1', status,
  })
  assert.equal(ack('load:a', 'ack-a').ok, true)
  assert.equal(runtime.snapshot().phase, 'loading', 'one fast client cannot start the match')
  assert.equal(ack('load:a', 'ack-a').duplicate, true, 'refresh retries reuse the same receipt')
  assert.equal(ack('load:b', 'stale-b', 'loaded', 'old-rules').code, 'LOAD_VERSION_MISMATCH')
  assert.equal(runtime.snapshot().sides.B?.loaded, false)
  runtime.markDisconnected('load:b')
  runtime.tick()
  runtime.markReconnected('load:b')
  assert.equal(ack('load:b', 'ack-b').ok, true)
  assert.equal(runtime.snapshot().phase, 'playing', 'reconnected client can finish ACK before deadline')
  assert.equal(runtime.projectForViewer('load:a').sides.B?.privateState, null)

  const failed = new PvpMatchRuntime({ matchId: 'load-failed', mode: 'custom_1v1', seed: 1, rulesetVersion: 'pvp-rules-v1', loadTimeoutMs: 1000 })
  failed.registerParticipant('A', { playerId: 'failed:a', playerName: '甲' }, true)
  failed.registerParticipant('B', { playerId: 'failed:b', playerName: '乙' }, true)
  const failedAck = (playerId: string, requestId: string) => failed.acknowledgeLoad(playerId, {
    requestId, rulesetVersion: 'pvp-rules-v1', mapId: DUAL_REALM_MAP.mapId, mapVersion: DUAL_REALM_MAP.mapVersion,
    routeHash: DUAL_REALM_MAP.routeHash, assetsVersion: 'pvp_assets_v1', status: 'failed', failureCode: 'ASSET_DECODE_FAILED',
  })
  assert.equal(failedAck('failed:a', 'failed-a').ok, true)
  assert.equal(failed.snapshot().result?.reason, 'load_failed')

  const timeout = new PvpMatchRuntime({ matchId: 'load-timeout', mode: 'custom_1v1', seed: 2, rulesetVersion: 'pvp-rules-v1', tickRateMs: 100, loadTimeoutMs: 300 })
  timeout.registerParticipant('A', { playerId: 'timeout:a', playerName: '甲' }, true)
  timeout.registerParticipant('B', { playerId: 'timeout:b', playerName: '乙' }, true)
  timeout.markDisconnected('timeout:b')
  timeout.tick(); timeout.tick(); timeout.tick()
  assert.equal(timeout.snapshot().result?.reason, 'load_disconnect')
}

export function runPvpV1SmokeChecks(): void {
  validateMap()
  validateRoundsPressureAndProjection()
  validateTerminalReasons()
  validateHumanLoadAcks()
  validateRecruitDeployMergeAndAutoCombat()
  validateDeterministicLoanerDraft()
}

if (require.main === module) {
  runPvpV1SmokeChecks()
  console.log('pvp-v1 smoke checks passed')
}
