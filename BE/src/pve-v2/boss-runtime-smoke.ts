import assert from 'node:assert/strict'
import { resolveBossEncounter } from './boss-catalog'
import {
  BossCombatRuntimeV1,
  isLaneWaveSpawningComplete,
  nextLaneSpawnEntityKind,
  settleBossControlDurationMs,
  settleEnemySlowBps,
  type BossRuntimeEnemyView,
  type BossRuntimeEncounter,
} from './boss-runtime'
import { PveGameRuntime } from './runtime'
import type { PveRuntimeEvent } from './types'

function enemy(id: string, laneOwnerPlayerId: string, laneSlot: 'P1' | 'P2', kind: 'boss' | 'ordinary_minion', hp = 100): BossRuntimeEnemyView {
  return {
    id,
    entityKind: kind,
    waveNumber: 5,
    laneOwnerPlayerId,
    laneSlot,
    currentHp: hp,
    maxHp: 100,
    lifecycle: 'alive',
  }
}

function eventSink() {
  const events: Array<{ type: PveRuntimeEvent['type']; data: PveRuntimeEvent['data'] }> = []
  return { events, emit: (type: PveRuntimeEvent['type'], data: PveRuntimeEvent['data']) => events.push({ type, data }) }
}

function runNodeWaveSpawn(seed: string) {
  const runtime = new PveGameRuntime({
    seed,
    levelId: 1,
    difficulty: 'easy',
    prepDurationMs: 0,
    initialWaveNumber: 5,
    maxWaves: 5,
  })
  assert.equal(runtime.registerPlayer('p1', 'P1').ok, true)
  assert.equal(runtime.start().ok, true)
  let snapshot = runtime.snapshot()
  for (let index = 0; index < 1000 && !snapshot.enemies.some((entry) => entry.entityKind === 'boss'); index += 1) {
    snapshot = runtime.tick()
  }
  const boss = snapshot.enemies.find((entry) => entry.entityKind === 'boss')
  assert.ok(boss, 'W5 must spawn one Boss after its ten ordinary minions')
  assert.equal(snapshot.enemies.filter((entry) => entry.entityKind === 'ordinary_minion').length, 10)
  assert.equal(snapshot.enemies.filter((entry) => entry.entityKind === 'boss').length, 1)
  assert.equal(snapshot.wave.lanes[0].spawnedCount, 10)
  assert.equal(snapshot.wave.lanes[0].totalCount, 10)
  assert.equal(snapshot.wave.lanes[0].bossRequired, true)
  assert.equal(snapshot.wave.lanes[0].bossSpawned, true)
  assert.equal(snapshot.wave.lanes[0].cleared, false)
  assert.equal(snapshot.status, 'running', 'the extra Boss must not consume an ordinary-minion overload slot')
  assert.equal(boss.spawnProtected, true)
  assert.equal(boss.invulnerable, false)
  assert.equal(boss.bossDefinitionId, 'boss_l1_w5_mountain_scout_v1')
  assert.equal(boss.bossName, '山魈先锋')
  assert.ok(boss.controlResistanceBps > 0)
  assert.equal(snapshot.bossRuntime.schemaVersion, 1)
  assert.equal(snapshot.bossRuntime.instances.length, 1)

  for (let index = 0; index < 80 && snapshot.enemies.find((entry) => entry.id === boss.id)?.spawnProtected; index += 1) {
    snapshot = runtime.tick()
  }
  const enteredBoss = snapshot.enemies.find((entry) => entry.id === boss.id)
  assert.ok(enteredBoss)
  assert.equal(enteredBoss.spawnProtected, false, 'Boss becomes targetable only after its body fully exits the spawn square')
  assert.ok(snapshot.recentEvents.some((entry) => entry.type === 'ENEMY_ENTERED_BATTLEFIELD' && entry.data.enemyId === boss.id))

  // 白盒只用于专项 smoke：验证真正的死亡结算入口，而不是复制一套奖励算法。
  const internals = runtime as unknown as {
    enemies: Array<BossRuntimeEnemyView & { lastDamagePlayerId: string | null; currentHp: number }>
    settleEnemyDeath(target: BossRuntimeEnemyView & { lastDamagePlayerId: string | null; currentHp: number }): void
  }
  for (const target of [...internals.enemies]) {
    target.lastDamagePlayerId = 'p1'
    target.currentHp = 0
    internals.settleEnemyDeath(target)
    internals.settleEnemyDeath(target)
  }
  snapshot = runtime.tick()
  assert.equal(snapshot.wave.lanes[0].cleared, true, 'Boss death is required before its lane can clear')
  assert.equal(snapshot.status, 'finished')
  assert.equal(snapshot.result?.outcome, 'victory')
  // 10初始 + 10只普通怪×1 + W5 Boss×5 + W5路线保底25。
  assert.equal(snapshot.players[0].rice, 50)
  assert.equal(snapshot.recentEvents.filter((entry) => entry.type === 'BOSS_DIED' && entry.data.enemyId === boss.id).length, 1)
  assert.equal(snapshot.recentEvents.filter((entry) => entry.type === 'RICE_GRANTED'
    && entry.data.enemyId === boss.id && entry.data.amount === 5).length, 1)
  return snapshot
}

function runFourPlayerTwentyWaveIntegration(seed: string) {
  const runtime = new PveGameRuntime({
    seed,
    levelId: 1,
    difficulty: 'easy',
    tickRateMs: 500,
    maxWaves: 20,
    eventHistoryLimit: 20000,
  })
  const registrations = [
    ['player-1', 'P1'], ['player-2', 'P2'], ['player-3', 'P3'], ['player-4', 'P4'],
  ] as const
  for (const [playerId, slot] of registrations) assert.equal(runtime.registerPlayer(playerId, slot).ok, true)
  assert.equal(runtime.start().ok, true)

  const seenEnemyIds = new Set<string>()
  const ordinaryByLane = new Map<string, number>()
  const bossSpawnKeys: string[] = []
  const internals = runtime as unknown as {
    enemies: Array<BossRuntimeEnemyView & {
      spawnProtected: boolean
      lastDamagePlayerId: string | null
      currentHp: number
    }>
    settleEnemyDeath(target: BossRuntimeEnemyView & {
      spawnProtected: boolean
      lastDamagePlayerId: string | null
      currentHp: number
    }): void
  }

  let snapshot = runtime.snapshot()
  for (let tick = 0; tick < 5000 && snapshot.status !== 'finished'; tick += 1) {
    snapshot = runtime.tick()
    for (const target of snapshot.enemies) {
      if (seenEnemyIds.has(target.id)) continue
      seenEnemyIds.add(target.id)
      if (target.entityKind === 'ordinary_minion') {
        ordinaryByLane.set(target.laneSlot, (ordinaryByLane.get(target.laneSlot) ?? 0) + 1)
      }
      else bossSpawnKeys.push(`${target.laneSlot}:${target.waveNumber}:${target.bossDefinitionId}`)
    }
    // 专项联调仅绕过UI布阵和伤害耗时；仍经过唯一 settleEnemyDeath、奖励、清波和事件入口。
    for (const target of [...internals.enemies]) {
      if (target.lifecycle !== 'alive' || target.spawnProtected) continue
      target.lastDamagePlayerId = target.laneOwnerPlayerId
      target.currentHp = 0
      internals.settleEnemyDeath(target)
    }
  }

  assert.equal(snapshot.status, 'finished')
  assert.equal(snapshot.result?.outcome, 'victory')
  assert.equal(seenEnemyIds.size, 816)
  for (const slot of ['P1', 'P2', 'P3', 'P4']) assert.equal(ordinaryByLane.get(slot), 200)
  assert.equal(bossSpawnKeys.length, 16)
  assert.equal(new Set(bossSpawnKeys).size, 16)
  for (const slot of ['P1', 'P2', 'P3', 'P4']) {
    for (const wave of [5, 10, 15, 20]) {
      assert.equal(bossSpawnKeys.filter((key) => key.startsWith(`${slot}:${wave}:`)).length, 1)
    }
  }
  for (const player of snapshot.players) {
    assert.deepEqual(player.clearedWaves, Array.from({ length: 20 }, (_, index) => index + 1))
  }
  const bossLaneClears = snapshot.recentEvents.filter((entry) => (
    entry.type === 'LANE_WAVE_CLEARED' && entry.data.bossNode === true
  ))
  assert.equal(bossLaneClears.length, 16)
  assert.ok(bossLaneClears.every((entry) => typeof entry.data.bossDefinitionId === 'string'))

  const eventCounts = Object.fromEntries([...new Set(snapshot.recentEvents.map((entry) => entry.type))]
    .sort().map((type) => [type, snapshot.recentEvents.filter((entry) => entry.type === type).length]))
  return {
    finalSnapshot: snapshot,
    eventCounts,
    bossSpawnKeys: bossSpawnKeys.slice().sort(),
    ordinaryByLane: Object.fromEntries([...ordinaryByLane.entries()].sort()),
  }
}

export function runBossRuntimeSmokeChecks() {
  assert.equal(nextLaneSpawnEntityKind({ ordinarySpawnedCount: 9, ordinaryTotalCount: 10,
    bossRequired: true, bossSpawned: false }), 'ordinary_minion')
  assert.equal(nextLaneSpawnEntityKind({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
    bossRequired: true, bossSpawned: false }), 'boss')
  assert.equal(nextLaneSpawnEntityKind({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
    bossRequired: true, bossSpawned: true }), null)
  assert.equal(isLaneWaveSpawningComplete({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
    bossRequired: true, bossSpawned: false }), false)
  assert.equal(isLaneWaveSpawningComplete({ ordinarySpawnedCount: 10, ordinaryTotalCount: 10,
    bossRequired: true, bossSpawned: true }), true)
  assert.equal(settleBossControlDurationMs(5000, 1000, 3000), 3000)
  assert.equal(settleBossControlDurationMs(1000, 4000, 1500), 600)
  assert.equal(settleEnemySlowBps('boss', 9000), 4000)
  assert.equal(settleEnemySlowBps('ordinary_minion', 9000), 8000)

  const deterministicA = runNodeWaveSpawn('boss-spawn-determinism')
  const deterministicB = runNodeWaveSpawn('boss-spawn-determinism')
  assert.deepEqual(deterministicA, deterministicB)

  const integrationA = runFourPlayerTwentyWaveIntegration('boss-four-player-integration')
  const integrationB = runFourPlayerTwentyWaveIntegration('boss-four-player-integration')
  assert.deepEqual(integrationA, integrationB)

  const hasteEncounter = resolveBossEncounter(1, 'easy', 5)
  assert.ok(hasteEncounter)
  const bossA = enemy('boss-a', 'player-a', 'P1', 'boss')
  const minionA = enemy('minion-a', 'player-a', 'P1', 'ordinary_minion')
  const minionB = enemy('minion-b', 'player-b', 'P2', 'ordinary_minion')
  const hasteRuntime = new BossCombatRuntimeV1(100)
  const hasteEvents = eventSink()
  hasteRuntime.registerBoss(bossA, hasteEncounter, 0, hasteEvents.emit)
  hasteRuntime.advance({ tick: 10, enemies: [bossA, minionA, minionB], emit: hasteEvents.emit })
  assert.equal(hasteRuntime.snapshot().instances[0].skillStates[0].lifecycle, 'warning')
  assert.ok(hasteRuntime.snapshot().instances[0].activeCast?.skillName.includes('山魈'))
  hasteRuntime.advance({ tick: 20, enemies: [bossA, minionA, minionB], emit: hasteEvents.emit })
  assert.equal(hasteRuntime.snapshot().instances[0].skillStates[0].lifecycle, 'active')
  assert.ok(hasteRuntime.movementRatioBps(minionA, [bossA, minionA, minionB], 20, hasteEvents.emit) > 10000)
  assert.equal(hasteRuntime.movementRatioBps(minionB, [bossA, minionA, minionB], 20, hasteEvents.emit), 10000,
    'each multiplayer lane owns an independent Boss skill projection')
  assert.ok(hasteEvents.events.some((entry) => entry.type === 'BOSS_CAST_WARNING'))
  assert.ok(hasteEvents.events.some((entry) => entry.type === 'BOSS_SKILL_CAST'))
  bossA.lifecycle = 'dead'
  hasteRuntime.handleBossDeath(bossA, 21, hasteEvents.emit)
  const endedBeforeRetry = hasteEvents.events.filter((entry) => entry.type === 'BOSS_SKILL_ENDED').length
  hasteRuntime.handleBossDeath(bossA, 21, hasteEvents.emit)
  assert.equal(hasteEvents.events.filter((entry) => entry.type === 'BOSS_SKILL_ENDED').length, endedBeforeRetry,
    'Boss cleanup/death is idempotent')
  assert.equal(hasteRuntime.movementRatioBps(minionA, [bossA, minionA], 21, hasteEvents.emit), 10000,
    'lane haste is removed immediately when its Boss dies')

  const guardEncounter = resolveBossEncounter(1, 'easy', 10)
  assert.ok(guardEncounter)
  const guardBoss = { ...enemy('guard-boss', 'player-a', 'P1', 'boss', 40), waveNumber: 10 }
  const guardRuntime = new BossCombatRuntimeV1(100)
  const guardEvents = eventSink()
  guardRuntime.registerBoss(guardBoss, guardEncounter, 0, guardEvents.emit)
  guardRuntime.advance({ tick: 0, enemies: [guardBoss], emit: guardEvents.emit })
  assert.equal(guardRuntime.snapshot().instances[0].skillStates[0].lifecycle, 'warning')
  guardRuntime.advance({ tick: 8, enemies: [guardBoss], emit: guardEvents.emit })
  assert.equal(guardRuntime.snapshot().instances[0].phase, 2)
  assert.ok(guardRuntime.damageTakenRatioBps(guardBoss, [guardBoss], 8, guardEvents.emit) < 10000)
  assert.ok(guardEvents.events.some((entry) => entry.type === 'BOSS_PHASE_CHANGED'))

  const normalGuard = resolveBossEncounter(1, 'normal', 10)
  const hardGuard = resolveBossEncounter(1, 'hard', 10)
  assert.ok(normalGuard && hardGuard)
  const reductionAt = (encounter: NonNullable<typeof guardEncounter>) => {
    const runtime = new BossCombatRuntimeV1(100)
    const sink = eventSink()
    const target = { ...guardBoss, id: `boss-${encounter.difficulty}` }
    runtime.registerBoss(target, encounter, 0, sink.emit)
    runtime.advance({ tick: 0, enemies: [target], emit: sink.emit })
    runtime.advance({ tick: 8, enemies: [target], emit: sink.emit })
    return runtime.damageTakenRatioBps(target, [target], 8, sink.emit)
  }
  assert.ok(reductionAt(hardGuard) < reductionAt(normalGuard))
  assert.ok(reductionAt(normalGuard) < reductionAt(guardEncounter))

  const unknownPluginEncounter: BossRuntimeEncounter = {
    catalogVersion: 'test',
    stats: { skillIntensityBps: 10000 },
    definition: {
      bossDefinitionId: 'plugin-isolation',
      displayName: '异常隔离测试',
      skills: [{ bindingId: 'bad', displayName: '坏插件', pluginId: 'missing_plugin', pluginVersion: 1,
        trigger: 'periodic', parameters: {} }],
    },
  }
  const isolated = new BossCombatRuntimeV1(100)
  const isolatedEvents = eventSink()
  const isolatedBoss = enemy('isolated', 'player-a', 'P1', 'boss')
  isolated.registerBoss(isolatedBoss, unknownPluginEncounter, 0, isolatedEvents.emit)
  assert.equal(isolated.snapshot().instances[0].skillStates[0].lifecycle, 'disabled')
  assert.equal(isolatedEvents.events.filter((entry) => entry.type === 'BOSS_SKILL_PLUGIN_ERROR').length, 1)

  return { deterministic: true, fourPlayerTwentyWave: true, spawning: true, spawnProtection: true, lifecycle: true,
    cleanup: true, multiplayerIsolation: true, pluginIsolation: true, difficultyIntensity: true }
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(runBossRuntimeSmokeChecks())}\n`)
}
