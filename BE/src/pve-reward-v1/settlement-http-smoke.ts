import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { PlayerAccountService } from '../account-v1'
import { MemoryPlayerAccountStore } from '../account-v1/memory-store'
import { createServerConfig } from '../config/server-config'
import { GameEngine } from '../core/game-engine'
import { RoomManager } from '../core/Room'
import { ActionRateLimiter } from '../network/action-rate-limiter'
import { createRestApiRouter } from '../network/rest-api'
import { ProgressStore } from '../data/progress-store'
import type { ReplayRecorder } from '../core/replay-recorder'
import { PveGameRuntime } from '../pve-v2'
import { PVE_WEAPON_REWARD_TABLE_REVISION } from '../weapon-v1'
import { MemoryPveRewardStore } from './memory-store'
import type { PveSettlementCommand, PveSettlementDetail } from './types'

interface SettlementEnvelope {
  ok: boolean
  status?: 'pending' | 'committed' | 'failed'
  attempts?: number
  lastError?: string | null
  settlement?: { status: 'committed'; detail?: PveSettlementDetail } | null
  detail?: PveSettlementDetail
  combatRulesetVersion?: string
}

async function main() {
  const config = {
    ...createServerConfig(),
    authRequired: true,
    authTokens: [{ token: 'settlement-token', playerId: 'settlement-http-player', playerName: 'Settlement Player', playerKind: 'human' as const }],
  }
  const accountService = new PlayerAccountService(new MemoryPlayerAccountStore())
  const rewardStore = new MemoryPveRewardStore()
  const runtime = new PveGameRuntime({ seed: 'settlement-http', levelId: 1, difficulty: 'easy' }).snapshot()
  const matchId = 'settlement-http-match'
  const settlementId = `${matchId}:settlement-http-player`
  const detail: PveSettlementDetail = {
    schemaVersion: 1,
    rules: { combatRulesetVersion: runtime.combatRulesetVersion, rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
      stageCatalogRevision: runtime.configSnapshot.stageCatalogRevision, balanceCatalogRevision: runtime.configSnapshot.balanceCatalogRevision },
    outcome: { victory: false, reason: 'defeat', highestCompletedWave: 0, maxWaves: runtime.configSnapshot.maxWaves },
    story: { title: '此回暂终', summary: '服务端故事', failureSuggestion: '先合成主力神将。' },
    performance: { damageDealt: null, kills: null, controlAppliedMs: null, rescues: null, mostDangerousWave: null, coverage: 'partial' },
    lineup: { coreGeneral: null, activeSynergies: [] }, mvp: null, rewards: [], pity: null,
  }
  const command: PveSettlementCommand = {
    settlementId,
    combatRulesetVersion: runtime.combatRulesetVersion,
    configSnapshot: runtime.configSnapshot,
    rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
    detail,
    input: {
      requestId: `settle:${settlementId}`,
      matchId,
      playerId: 'settlement-http-player',
      reason: 'defeat',
      highestCompletedWave: 0,
      officialVictory: false,
      retainedWeaponFragments: {},
      stageSelection: { levelId: 1, difficulty: 'easy' },
    },
  }
  await rewardStore.prepareSettlement(command, JSON.stringify(command))

  const app = express()
  app.use(express.json())
  app.use('/api', createRestApiRouter(
    new GameEngine(config), new RoomManager(config), config,
    new ActionRateLimiter(1000, 100), {} as ReplayRecorder, null,
    new ProgressStore(), accountService, rewardStore,
  ))
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/settlements/${matchId}`
  const get = async () => {
    const response = await fetch(url, { headers: { Authorization: 'Bearer settlement-token' } })
    assert.equal(response.status, 200)
    return response.json() as Promise<SettlementEnvelope>
  }

  try {
    const pending = await get()
    assert.equal(pending.status, 'pending')
    assert.equal(pending.settlement, null)
    assert.equal(pending.combatRulesetVersion, 'pve-v2.3.0')
    assert.equal(pending.detail?.story.failureSuggestion, '先合成主力神将。')

    await rewardStore.markSettlementFailed(settlementId, 'simulated durable failure')
    const failed = await get()
    assert.equal(failed.status, 'failed')
    assert.match(failed.lastError ?? '', /simulated durable failure/)

    const settlement = await accountService.settleMatch(command.input)
    await rewardStore.markSettlementCommitted(settlementId, settlement)
    const committed = await get()
    assert.equal(committed.status, 'committed')
    assert.equal(committed.settlement?.status, 'committed')
    assert.equal(committed.settlement?.detail?.schemaVersion, 1)
    console.log('pve settlement HTTP status smoke passed')
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
