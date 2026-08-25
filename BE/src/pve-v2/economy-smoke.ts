import assert from 'node:assert/strict'
import { resolveBossEncounter } from './boss-catalog'
import {
  PVE_FULL_MATCH_BASE_GROSS_RICE,
  allocatePveBaseXpByContribution,
  resolvePveBossRiceReward,
  resolvePveLaneClearRiceReward,
  resolvePvePaidRecruitBaseCost,
} from './economy'
import { PveGameRuntime } from './runtime'
import { getActiveItemDefinition, type MatchItemLoadoutSnapshot } from '../item-v1'
import type { GeneralFormationManager } from '../core/hero-v1/formation-manager'

function checkEconomyTables() {
  assert.deepEqual(Array.from({ length: 20 }, (_, index) => resolvePveLaneClearRiceReward(index + 1)), [
    3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 10,
  ])
  assert.deepEqual([5, 10, 15, 20].map(resolvePveBossRiceReward), [3, 5, 8, 12])
  assert.equal(PVE_FULL_MATCH_BASE_GROSS_RICE, 335)
  assert.deepEqual(Array.from({ length: 12 }, (_, index) => resolvePvePaidRecruitBaseCost(index)), [
    5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8,
  ])
  assert.equal(Array.from({ length: 30 }, (_, index) => resolvePvePaidRecruitBaseCost(index))
    .reduce((sum, cost) => sum + cost, 0), 285)
  assert.equal(resolvePvePaidRecruitBaseCost(29), 14)
  assert.equal(resolvePvePaidRecruitBaseCost(30), 17, '第31批（completed=30）开始固定增加2软封顶成本')
  assert.equal(resolvePvePaidRecruitBaseCost(31), 17)
}

function checkXpContributionSplit() {
  const split = allocatePveBaseXpByContribution(1000, [
    { contributionKey: 'p1:g1:physical', category: 'physical' },
    { contributionKey: 'p2:g2:magic', category: 'magic' },
    { contributionKey: 'p3:g3:control', category: 'control' },
  ])
  assert.equal([...split.values()].reduce((sum, points) => sum + points, 0), 1000)
  assert.equal(split.get('p3:g3:control'), 111)
  assert.equal(split.get('p1:g1:physical'), 445)
  assert.equal(split.get('p2:g2:magic'), 444)
  const controlHeavy = allocatePveBaseXpByContribution(1000, [
    { contributionKey: 'damage', category: 'summon' },
    ...Array.from({ length: 8 }, (_, index) => ({ contributionKey: `control-${index}`, category: 'control' as const })),
  ])
  const controlTotal = [...controlHeavy.entries()]
    .filter(([key]) => key.startsWith('control-'))
    .reduce((sum, [, points]) => sum + points, 0)
  assert.equal(controlTotal, 200)
  assert.equal(controlHeavy.get('damage'), 800)
}

function checkLaneOwnerEconomy() {
  const runtime = new PveGameRuntime({ seed: 'lane-owner-economy', prepDurationMs: 0, maxWaves: 1 })
  runtime.registerPlayer('owner', 'P1')
  runtime.registerPlayer('helper', 'P2')
  runtime.start()
  let snapshot = runtime.tick()
  for (let tick = 0; tick < 100 && !snapshot.enemies.some(enemy => enemy.laneOwnerPlayerId === 'owner'); tick += 1) {
    snapshot = runtime.tick()
  }
  const internals = runtime as unknown as {
    enemies: Array<{ id: string; laneOwnerPlayerId: string; lifecycle: 'alive' | 'dead'; currentHp: number; lastDamagePlayerId: string | null }>
    settleEnemyDeath(enemy: { id: string; laneOwnerPlayerId: string; lifecycle: 'alive' | 'dead'; currentHp: number; lastDamagePlayerId: string | null }): void
  }
  const target = internals.enemies.find(enemy => enemy.laneOwnerPlayerId === 'owner')
  assert.ok(target)
  target.lastDamagePlayerId = 'helper'
  target.currentHp = 0
  internals.settleEnemyDeath(target)
  const players = runtime.snapshot().players
  assert.equal(players.find(player => player.playerId === 'owner')?.rice, 11)
  assert.equal(players.find(player => player.playerId === 'helper')?.rice, 10)
  const reward = runtime.snapshot().recentEvents.find(event => event.type === 'RICE_GRANTED' && event.data.enemyId === target.id)
  assert.equal(reward?.data.playerId, 'owner')
  assert.equal(reward?.data.reason, 'LANE_OWNER_MINION_DEFEATED')
  const assist = runtime.snapshot().recentEvents.find(event => event.type === 'ASSIST_RECORDED')
  assert.equal(assist?.data.playerId, 'helper')
  assert.equal(assist?.data.includedLastDamage, true)

  for (const waveNumber of [5, 10, 15, 20] as const) {
    assert.equal(resolveBossEncounter(1, 'easy', waveNumber)!.rewardProfile.rice, resolvePveBossRiceReward(waveNumber))
  }
}

function checkCrossPlayerXpSettlement() {
  const runtime = new PveGameRuntime({ seed: 'cross-player-xp', prepDurationMs: 0, maxWaves: 1 })
  runtime.registerPlayer('owner', 'P1')
  runtime.registerPlayer('helper', 'P2')
  runtime.start()
  let snapshot = runtime.tick()
  for (let tick = 0; tick < 100 && !snapshot.enemies.some(enemy => enemy.laneOwnerPlayerId === 'owner'); tick += 1) {
    snapshot = runtime.tick()
  }
  type Contribution = {
    ownerPlayerId: string
    generalId: string
    category: 'physical' | 'magic' | 'summon' | 'control'
    lastContributionTick: number
  }
  type InternalEnemy = {
    id: string
    laneOwnerPlayerId: string
    lifecycle: 'alive' | 'dead'
    currentHp: number
    lastDamagePlayerId: string | null
    experiencePoints: number
    generalContributions: Map<string, Contribution>
  }
  const internals = runtime as unknown as {
    currentTick: number
    enemies: InternalEnemy[]
    generalFormations: GeneralFormationManager
    settleEnemyDeath(enemy: InternalEnemy): void
  }
  for (const playerId of ['owner', 'helper']) {
    const result = internals.generalFormations.reconcilePlayer(playerId, [
      { tokenId: `${playerId}-hou`, ownerPlayerId: playerId, glyph: '后', x: 1, y: 1 },
      { tokenId: `${playerId}-yi`, ownerPlayerId: playerId, glyph: '羿', x: 2, y: 1 },
    ], 0, 10, internals.currentTick)
    assert.deepEqual(result.activatedGeneralIds, ['houyi'])
  }
  const target = internals.enemies.find(enemy => enemy.laneOwnerPlayerId === 'owner')
  assert.ok(target)
  target.experiencePoints = 1000
  target.generalContributions.set('owner:houyi:physical', {
    ownerPlayerId: 'owner', generalId: 'houyi', category: 'physical', lastContributionTick: internals.currentTick,
  })
  target.generalContributions.set('helper:houyi:magic', {
    ownerPlayerId: 'helper', generalId: 'houyi', category: 'magic', lastContributionTick: internals.currentTick,
  })
  target.generalContributions.set('helper:houyi:control', {
    ownerPlayerId: 'helper', generalId: 'houyi', category: 'control', lastContributionTick: internals.currentTick,
  })
  target.lastDamagePlayerId = 'helper'
  target.currentHp = 0
  internals.settleEnemyDeath(target)
  const players = runtime.snapshot().players
  assert.equal(players.find(player => player.playerId === 'owner')?.generalProgress[0]?.experiencePoints, 444)
  assert.equal(players.find(player => player.playerId === 'helper')?.generalProgress[0]?.experiencePoints, 556)
  assert.equal(players.find(player => player.playerId === 'owner')?.rice, 11)
  assert.equal(players.find(player => player.playerId === 'helper')?.rice, 10)
  const xpEvents = runtime.snapshot().recentEvents.filter(event => event.type === 'GENERAL_XP_GRANTED')
  assert.deepEqual(xpEvents.map(event => [event.data.playerId, event.data.xpPoints]), [
    ['helper', 556], ['owner', 444],
  ])
}

function checkFreeRefreshDoesNotConsumePaidCurve() {
  const playerId = 'free-refresh-player'
  const rerecruit = getActiveItemDefinition('rerecruit_order')!
  const itemSnapshot: MatchItemLoadoutSnapshot = {
    snapshotVersion: 1,
    catalogVersion: 1,
    playerId,
    accountVersion: 1,
    activeSlots: ['rerecruit_order', null],
    passiveSlots: [null, null, null, null, null, null],
    activeItems: [rerecruit],
    passiveItems: [],
  }
  const runtime = new PveGameRuntime({
    seed: 'free-refresh-economy', prepDurationMs: 0, maxWaves: 1,
    itemLoadoutSnapshots: { [playerId]: itemSnapshot },
  })
  runtime.registerPlayer(playerId, 'P1')
  assert.equal(runtime.handleAction(playerId, { type: 'RECRUIT_BATCH', actionId: 'paid-1' }).ok, true)
  const paid = runtime.snapshot().players[0]
  assert.equal(paid.recruitCount, 1)
  assert.equal(paid.nextRecruitCost, 5)
  const playerInternals = runtime as unknown as {
    players: Map<string, { noCharacterPaidRecruitBatches: number }>
  }
  playerInternals.players.get(playerId)!.noCharacterPaidRecruitBatches = 4
  runtime.start()
  assert.equal(runtime.handleAction(playerId, {
    type: 'USE_ACTIVE_ITEM', actionId: 'free-refresh', requestId: 'free-refresh-request',
    slotIndex: 0, itemId: 'rerecruit_order', target: { kind: 'none' }, expectedItemRuntimeVersion: 1,
  }).ok, true)
  const refreshed = runtime.snapshot().players[0]
  assert.equal(refreshed.recruitCount, 1)
  assert.equal(refreshed.nextRecruitCost, 5)
  assert.equal(refreshed.rice, 5)
  assert.equal(playerInternals.players.get(playerId)?.noCharacterPaidRecruitBatches, 4,
    '免费刷新不得消耗或重置付费招募保底计数')
}

export function runPveEconomySmokeChecks() {
  checkEconomyTables()
  checkXpContributionSplit()
  checkLaneOwnerEconomy()
  checkCrossPlayerXpSettlement()
  checkFreeRefreshDoesNotConsumePaidCurve()
  return { grossRice: PVE_FULL_MATCH_BASE_GROSS_RICE,
    checks: ['income-table', 'recruit-curve', 'xp-split', 'lane-owner-economy', 'assist-record', 'cross-player-xp', 'free-refresh-compatibility'] }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(runPveEconomySmokeChecks())}\n`)
