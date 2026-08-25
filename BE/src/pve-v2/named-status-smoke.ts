import assert from 'node:assert/strict'
import { HOUYI_DEFINITION } from '../core/hero-v1/catalog'
import type {
  GeneralAbilityTargeting,
  GeneralDefinition,
  LevelCurve,
  StatusApplyEffectDefinition,
} from '../core/hero-v1/types'
import { PveGameRuntime } from './runtime'

const fixed = (value: number): LevelCurve => [value, value, value, value, value]
const enemyTarget: GeneralAbilityTargeting = {
  kind: 'single', scope: 'enemies_in_attack_range', priority: 'furthest_progress', targetLimit: 1,
}
const selfTarget: GeneralAbilityTargeting = { kind: 'self', scope: 'self', targetLimit: 0 }

function status(
  effectId: string,
  statusId: string,
  magnitude: number,
  durationMs: number,
  targeting: GeneralAbilityTargeting,
  chanceBps = 10000,
  policy: StatusApplyEffectDefinition['stacking']['policy'] = 'refresh',
  maxStacks = 1,
): StatusApplyEffectDefinition {
  return { effectId, type: 'status_apply', statusId, targeting,
    magnitudeByLevel: fixed(magnitude), durationMsByLevel: fixed(durationMs),
    chanceBpsByLevel: fixed(chanceBps), stacking: { stackGroup: effectId, policy, maxStacks }, tags: ['smoke'] }
}

const NAMED_STATUS_GENERAL: GeneralDefinition = {
  ...HOUYI_DEFINITION,
  baseStats: {
    attackByLevel: fixed(1), attackIntervalMsByLevel: fixed(1000), attackRangeMilliCellsByLevel: fixed(10000),
    critChanceBpsByLevel: fixed(0), critDamageBpsByLevel: fixed(15000),
  },
  basicAttack: {
    attackId: 'named_status_basic', targeting: { scope: 'enemies_in_radius', priority: 'furthest_progress', targetLimit: 1 },
    effect: { effectId: 'named_status_basic_damage', type: 'damage', damageType: 'physical',
      coefficientBpsByLevel: fixed(10000), flatDamageByLevel: fixed(0), criticalPolicy: 'cannot_crit', tags: ['basic_attack'] },
  },
  activeSkill: {
    skillId: 'named_status_active', skillName: '具名状态验证', trigger: 'auto', cooldownMsByLevel: fixed(2000),
    targeting: enemyTarget,
    effects: [
      status('resistance_down', 'control_resistance_down', 2000, 5000, enemyTarget),
      status('boosted_stun', 'stun', 0, 1000, enemyTarget, 9000),
      status('trait_lock', 'suppress_active_trait', 0, 5000, enemyTarget),
      status('self_attack_speed', 'attack_speed_up', 5000, 5000, selfTarget),
      status('self_next_basic', 'next_basic_attack_damage_up', 10000, 5000, selfTarget),
    ],
  },
  passiveSkill: {
    skillId: 'named_status_passive', skillName: '当前生命斩', trigger: { kind: 'on_basic_attack' }, effects: [],
    structuredEffects: [status('current_hp_strike', 'current_hp_physical_damage', 500, 1, enemyTarget)],
  },
}

function createRuntime(): PveGameRuntime {
  for (let seedIndex = 0; seedIndex < 10000; seedIndex += 1) {
    const runtime = new PveGameRuntime({ seed: `named-status-${seedIndex}`, tickRateMs: 100, prepDurationMs: 0,
      maxWaves: 1, characterTokens: { '后': 1, '羿': 1 }, generalCatalog: { houyi: NAMED_STATUS_GENERAL },
      eventHistoryLimit: 3000, isDeployableCell: () => true })
    runtime.registerPlayer('named-player', 'P1')
    runtime.handleAction('named-player', { type: 'RECRUIT_BATCH', actionId: 'recruit' })
    const tray = runtime.snapshot().players[0].tray
    const left = tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === '后')
    const right = tray.findIndex((piece) => piece?.kind === 'character' && piece.glyph === '羿')
    if (left < 0 || right < 0) continue
    assert.equal(runtime.handleAction('named-player', { type: 'SWAP_TRAY_BOARD', actionId: 'left',
      trayIndex: left, boardX: 10, boardY: 17 }).ok, true)
    assert.equal(runtime.handleAction('named-player', { type: 'SWAP_TRAY_BOARD', actionId: 'right',
      trayIndex: right, boardX: 11, boardY: 17 }).ok, true)
    assert.equal(runtime.snapshot().players[0].generalFormations[0]?.generalId, 'houyi')
    return runtime
  }
  throw new Error('Unable to form named status smoke general')
}

export function runNamedStatusSmokeChecks(): {
  spawnProtection: true
  currentHpDamage: true
  nextBasicOnce: true
  attackSpeed: true
  controlResistance: true
  activeTraitSuppression: true
  deathCleanup: true
} {
  const runtime = createRuntime()
  assert.equal(runtime.start().ok, true)

  let protectedEnemyId: string | null = null
  for (let guard = 0; guard < 500; guard += 1) {
    const snapshot = runtime.tick()
    const enemy = snapshot.enemies[0]
    if (!enemy) continue
    protectedEnemyId ??= enemy.id
    if (!enemy.spawnProtected) break
    assert.equal(snapshot.statuses.some((entry) => entry.enemyId === enemy.id), false)
    assert.equal(snapshot.recentEvents.some((event) => event.type === 'DAMAGE_APPLIED'
      && event.data.enemyId === enemy.id), false)
  }
  assert.ok(protectedEnemyId)

  let statusSnapshot = runtime.snapshot()
  for (let guard = 0; guard < 100 && !statusSnapshot.statuses.some((entry) => (
    entry.enemyId === protectedEnemyId && entry.statusId === 'suppress_active_trait'
  )); guard += 1) statusSnapshot = runtime.tick()

  const resistance = statusSnapshot.statuses.find((entry) => entry.enemyId === protectedEnemyId
    && entry.statusId === 'control_resistance_down')
  const stun = statusSnapshot.statuses.find((entry) => entry.enemyId === protectedEnemyId && entry.statusId === 'stun')
  const traitLock = statusSnapshot.statuses.find((entry) => entry.enemyId === protectedEnemyId
    && entry.statusId === 'suppress_active_trait')
  assert.ok(resistance && stun && traitLock, JSON.stringify({ statuses: statusSnapshot.statuses,
    events: statusSnapshot.recentEvents.filter((event) => event.type.includes('GENERAL') || event.type.includes('STATUS') || event.type === 'DAMAGE_APPLIED') }))
  const stunEvent = [...statusSnapshot.recentEvents].reverse().find((event) => event.type === 'STATUS_APPLIED'
    && event.data.enemyId === protectedEnemyId && event.data.statusId === 'stun')
  assert.equal(stunEvent?.data.controlResistanceDownBps, 2000)
  assert.equal(stunEvent?.data.chanceBps, 10000)
  assert.equal(stunEvent?.data.durationMs, 1200)
  assert.equal(runtime.isEnemyActiveTraitSuppressed(protectedEnemyId), true)

  const progressWithSpeed = statusSnapshot.players[0].generalProgress[0]
  assert.ok(progressWithSpeed.activeStatuses.some((entry) => entry.statusId === 'attack_speed_up'))
  assert.equal(progressWithSpeed.attackIntervalMs, 667)

  const consumedEvents = statusSnapshot.recentEvents.filter((event) => event.type === 'GENERAL_STATUS_CONSUMED'
    && event.data.statusId === 'next_basic_attack_damage_up')
  assert.equal(consumedEvents.length, 1)
  assert.equal(progressWithSpeed.activeStatuses.some((entry) => entry.statusId === 'next_basic_attack_damage_up'), false)
  const basicDamageEvents = statusSnapshot.recentEvents.filter((event) => event.type === 'DAMAGE_APPLIED'
    && event.data.sourceKind === 'basic_attack' && event.data.generalId === 'houyi')
  assert.ok(basicDamageEvents.length >= 1)
  const consumeTick = Number(consumedEvents[0].tick)
  const empoweredBasic = basicDamageEvents.find((event) => event.tick === consumeTick)
  assert.equal(empoweredBasic?.data.rawDamage, 2)

  const currentHpEvent = statusSnapshot.recentEvents.find((event) => event.type === 'DAMAGE_APPLIED'
    && event.data.effectId === 'current_hp_strike')
  assert.ok(currentHpEvent)
  assert.equal(currentHpEvent.data.rawDamage,
    Math.max(1, Math.floor(Number(currentHpEvent.data.hpBefore) * 500 / 10000)))

  // suppress_active_trait 不是 stun：等眩晕过期后，封禁仍在，但怪物继续移动且可被普攻。
  while (runtime.snapshot().statuses.some((entry) => entry.enemyId === protectedEnemyId && entry.statusId === 'stun')) runtime.tick()
  const beforeMove = runtime.snapshot().enemies.find((enemy) => enemy.id === protectedEnemyId)?.pathProgressMilli ?? -1
  const attacksBefore = runtime.snapshot().recentEvents.filter((event) => event.type === 'DAMAGE_APPLIED'
    && event.data.sourceKind === 'basic_attack').length
  for (let count = 0; count < 4; count += 1) runtime.tick()
  const afterMoveSnapshot = runtime.snapshot()
  const afterMove = afterMoveSnapshot.enemies.find((enemy) => enemy.id === protectedEnemyId)?.pathProgressMilli ?? -1
  assert.ok(afterMove > beforeMove)
  assert.equal(runtime.isEnemyActiveTraitSuppressed(protectedEnemyId), true)
  assert.ok(afterMoveSnapshot.recentEvents.filter((event) => event.type === 'DAMAGE_APPLIED'
    && event.data.sourceKind === 'basic_attack').length >= attacksBefore)

  let deadEnemyId: string | null = null
  for (let guard = 0; guard < 1000 && !deadEnemyId; guard += 1) {
    const next = runtime.tick()
    const death = [...next.recentEvents].reverse().find((event) => event.type === 'ENEMY_DIED')
    if (death) deadEnemyId = String(death.data.enemyId)
  }
  assert.ok(deadEnemyId)
  runtime.tick()
  assert.equal(runtime.snapshot().statuses.some((entry) => entry.enemyId === deadEnemyId), false)

  return { spawnProtection: true, currentHpDamage: true, nextBasicOnce: true, attackSpeed: true,
    controlResistance: true, activeTraitSuppression: true, deathCleanup: true }
}

if (require.main === module) {
  console.log(JSON.stringify(runNamedStatusSmokeChecks()))
}
