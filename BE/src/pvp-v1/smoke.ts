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

function readyRuntime(matchId: string): PvpMatchRuntime {
  const runtime = new PvpMatchRuntime({
    matchId,
    mode: 'ranked_1v1',
    seed: `seed:${matchId}`,
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

export function runPvpV1SmokeChecks(): void {
  validateMap()
  validateRoundsPressureAndProjection()
  validateTerminalReasons()
}

if (require.main === module) {
  runPvpV1SmokeChecks()
  console.log('pvp-v1 smoke checks passed')
}
