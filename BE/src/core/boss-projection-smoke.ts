import assert from 'node:assert/strict'
import type { PveEnemySnapshot } from '../pve-v2/types'
import { projectPveEnemySnapshot } from './game-engine'

const boss: PveEnemySnapshot = {
  id: 'boss-1',
  entityKind: 'boss',
  bossDefinitionId: 'boss_l1_w5_mountain_scout_v1',
  bossName: '山魈先锋',
  controlResistanceBps: 3500,
  controlDurationCapMs: 1500,
  bossPhase: 2,
  activeCast: {
    skillId: 'mountain_rush',
    skillName: '山魈突进',
    startedAtTick: 100,
    executeAtTick: 112,
    targetPlayerIds: ['player-1'],
  },
  glyph: '魈',
  waveNumber: 5,
  laneOwnerPlayerId: 'player-1',
  laneSlot: 'P1',
  spawnSequence: 11,
  xMilli: 14500,
  yMilli: 19500,
  routeWaypointIndex: 2,
  lapCount: 0,
  pathProgressMilli: 500,
  currentHp: 800,
  maxHp: 1000,
  armor: 20,
  magicResistance: 15,
  moveSpeedMilliCellsPerSecond: 1000,
  lastDamagePlayerId: null,
  spawnProtected: true,
  invulnerable: false,
}

const projected = projectPveEnemySnapshot(boss, 4)
assert.equal(projected.entityKind, 'boss')
assert.equal(projected.bossName, '山魈先锋')
assert.equal(projected.routeZone, 'private_lane')
assert.equal(projected.spawnProtected, true)
assert.equal(projected.invulnerable, false, '出生空间锁不能被投影成护盾/无敌')
assert.deepEqual(projected.activeCast, boss.activeCast)
assert.notEqual(projected.activeCast?.targetPlayerIds, boss.activeCast?.targetPlayerIds)
assert.deepEqual({ x: projected.x, y: projected.y }, { x: 14.5, y: 19.5 })

const ordinary = projectPveEnemySnapshot({
  ...boss,
  id: 'ordinary-1',
  entityKind: 'ordinary_minion',
  bossDefinitionId: null,
  bossName: null,
  controlResistanceBps: 0,
  controlDurationCapMs: 0,
  bossPhase: 0,
  activeCast: null,
  spawnProtected: false,
  routeWaypointIndex: 4,
}, 4)
assert.equal(ordinary.entityKind, 'ordinary_minion')
assert.equal(ordinary.bossDefinitionId, null)
assert.equal(ordinary.routeZone, 'public_loop')

console.log('boss protocol projection smoke checks passed')
