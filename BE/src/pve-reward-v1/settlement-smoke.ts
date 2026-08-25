import assert from 'node:assert/strict'
import { PlayerAccountService } from '../account-v1/service'
import { MemoryPlayerAccountStore } from '../account-v1/memory-store'
import type { PlayerAccountRecord } from '../account-v1/types'
import type { PlayerAccountStore } from '../data/player-account-store'
import { PveGameRuntime } from '../pve-v2'
import { PVE_WEAPON_REWARD_TABLE_REVISION } from '../weapon-v1'
import { MemoryPveRewardStore } from './memory-store'
import { PveSettlementCoordinator } from './settlement'
import {
  buildPveSettlementDetail,
  createSettlementTelemetry,
  ingestSettlementEvents,
  resolveSettlementStats,
  type SettlementRuntimeEvent,
} from './settlement-detail'
import type { PveSettlementCommand } from './types'

class FailFirstAccountWriteStore implements PlayerAccountStore {
  private readonly inner = new MemoryPlayerAccountStore()
  private shouldFail = true

  isEnabled(): boolean { return true }
  get(playerId: string) { return this.inner.get(playerId) }
  createIfAbsent(account: PlayerAccountRecord) { return this.inner.createIfAbsent(account) }
  async compareAndSwap(playerId: string, expectedVersion: number, next: PlayerAccountRecord) {
    if (this.shouldFail) {
      this.shouldFail = false
      throw new Error('simulated account persistence outage')
    }
    return this.inner.compareAndSwap(playerId, expectedVersion, next)
  }
}

async function runSettlementRecoveryCheck() {
  const rewardStore = new MemoryPveRewardStore()
  const accountService = new PlayerAccountService(new FailFirstAccountWriteStore())
  const coordinator = new PveSettlementCoordinator(rewardStore, accountService)
  const runtimeSnapshot = new PveGameRuntime({ seed: 'settlement-smoke', levelId: 1, difficulty: 'easy' }).snapshot()
  assert.equal(runtimeSnapshot.configSnapshot.runtimeKind, 'pve-v2')
  assert.equal(runtimeSnapshot.configSnapshot.stageId, 'flower_fruit_mountain_v1')
  assert.equal(runtimeSnapshot.combatRulesetVersion, 'pve-v2.3.0')

  const command: PveSettlementCommand = {
    settlementId: 'settlement-smoke-match:p1',
    combatRulesetVersion: runtimeSnapshot.combatRulesetVersion,
    configSnapshot: runtimeSnapshot.configSnapshot,
    rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
    input: {
      requestId: 'settle:settlement-smoke-match:p1',
      matchId: 'settlement-smoke-match',
      playerId: 'p1',
      reason: 'disconnect_exit',
      highestCompletedWave: 5,
      officialVictory: false,
      retainedWeaponFragments: { weapon_smoke: 1 },
      stageSelection: { levelId: 1, difficulty: 'easy' },
    },
  }

  await assert.rejects(coordinator.settle(command), /simulated account persistence outage/)
  const failed = await rewardStore.getSettlement(command.settlementId)
  assert.equal(failed?.status, 'failed')
  assert.equal(failed?.attempts, 1)
  assert.match(failed?.lastError ?? '', /simulated account persistence outage/)

  const recovery = await coordinator.recover()
  assert.deepEqual(recovery, { recovered: 1, failed: 0 })
  const committed = await rewardStore.getSettlement(command.settlementId)
  assert.equal(committed?.status, 'committed')
  assert.equal(committed?.attempts, 2)
  assert.equal(committed?.settlement?.status, 'committed')
  assert.deepEqual(committed?.configSnapshot, runtimeSnapshot.configSnapshot)

  const account = await accountService.getOrCreate('p1')
  assert.equal(account.wallet.gold, 10)
  assert.equal(account.weapon.fragmentBalances.weapon_smoke, 1)
  assert.equal(Object.keys(account.settlementsById).length, 1)
  assert.deepEqual(await coordinator.recover(), { recovered: 0, failed: 0 })
}

async function runSettlementDetailRoundTripCheck() {
  const rewardStore = new MemoryPveRewardStore()
  const accountService = new PlayerAccountService(new MemoryPlayerAccountStore())
  const coordinator = new PveSettlementCoordinator(rewardStore, accountService)
  const runtimeSnapshot = new PveGameRuntime({ seed: 'settlement-detail', levelId: 1, difficulty: 'hard' }).snapshot()
  const telemetry = createSettlementTelemetry('settlement-detail-match')
  const events: SettlementRuntimeEvent[] = [
    { id: 'start', tick: 0, type: 'MATCH_STARTED', data: {} },
    { id: 'damage-1', tick: 1, type: 'DAMAGE_APPLIED', data: { playerId: 'p1', generalId: 'houyi', finalDamage: 120 } },
    { id: 'control-1', tick: 1, type: 'STATUS_APPLIED', data: { generalId: 'houyi', statusId: 'stun', durationMs: 1500 } },
    { id: 'kill-1', tick: 2, type: 'ENEMY_DIED', data: { lastDamagePlayerId: 'p1' } },
    { id: 'assist-1', tick: 2, type: 'ASSIST_RECORDED', data: { playerId: 'p2' } },
  ]
  ingestSettlementEvents(telemetry, events)
  ingestSettlementEvents(telemetry, events)
  const players = [
    { playerId: 'p1', generalProgress: [{ generalId: 'houyi', name: '后羿', level: 3 }], activeSynergies: [{ synergyId: 'moon', name: '月宫同被', level: 2 }] },
    { playerId: 'p2', generalProgress: [{ generalId: 'change', name: '嫦娥', level: 2 }], activeSynergies: [] },
  ]
  const allStats = resolveSettlementStats(telemetry, players)
  assert.equal(allStats.get('p1')?.damageDealt, 120, 'duplicate event ids must not inflate settlement facts')
  assert.equal(allStats.get('p1')?.controlAppliedMs, 1500)
  const detail = buildPveSettlementDetail({
    configSnapshot: runtimeSnapshot.configSnapshot,
    rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
    reason: 'defeat', officialVictory: false, highestCompletedWave: 6,
    player: players[0]!, allStats, coverageComplete: telemetry.sawMatchStarted,
    rewardEvents: [{
      schemaVersion: 1, eventId: 'fragment-event', rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
      matchId: telemetry.matchId, playerId: 'p1', stage: { levelId: 1, stageId: runtimeSnapshot.configSnapshot.stageId, difficulty: 'hard' },
      source: 'wave_milestone', milestone: 5, dropIndex: 0, weaponId: 'weapon-houyi', quality: 'purple', amount: 1,
    }],
    firstClear: false,
  })
  assert.equal(detail.performance.mostDangerousWave, null, 'unavailable facts must remain absent rather than inferred')
  assert.equal(detail.mvp?.playerId, 'p1')
  assert.equal(detail.mvp?.basis.find(entry => entry.metric === 'kills')?.weightBps, 500, 'last hit must not dominate MVP')
  const command: PveSettlementCommand = {
    settlementId: 'settlement-detail-match:p1', combatRulesetVersion: runtimeSnapshot.combatRulesetVersion,
    configSnapshot: runtimeSnapshot.configSnapshot, rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION, detail,
    input: { requestId: 'settle:settlement-detail-match:p1', matchId: 'settlement-detail-match', playerId: 'p1',
      reason: 'defeat', highestCompletedWave: 6, officialVictory: false, retainedWeaponFragments: { 'weapon-houyi': 1 },
      stageSelection: { levelId: 1, difficulty: 'hard' } },
  }
  const committed = await coordinator.settle(command)
  assert.equal(committed.detail?.schemaVersion, 1)
  assert.ok(committed.detail?.rewards.some(reward => reward.kind === 'gold' && reward.amount === 10))
  assert.ok(committed.detail?.rewards.some(reward => reward.rewardId === 'fragment-event' && reward.rarity === 'purple'))
  assert.deepEqual(await coordinator.settle(command), committed, 'refresh/retry returns the same committed durable record')
  assert.equal(Object.keys((await accountService.getOrCreate('p1')).settlementsById).length, 1)
}

export async function runPveSettlementSmokeChecks() {
  await runSettlementRecoveryCheck()
  await runSettlementDetailRoundTripCheck()
  return { checks: ['ruleset-snapshot', 'failed-status', 'restart-recovery', 'exactly-once-account-commit', 'detail-round-trip', 'event-idempotency', 'mvp-weighting', 'legacy-compatibility'] }
}

if (require.main === module) void runPveSettlementSmokeChecks()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
