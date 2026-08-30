import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { PlayerAccountService } from '../account-v1'
import { MemoryPlayerAccountStore } from '../account-v1/memory-store'
import { createServerConfig } from '../config/server-config'
import { GameEngine } from '../core/game-engine'
import { RoomManager } from '../core/Room'
import { ActionRateLimiter } from '../network/action-rate-limiter'
import { createRestApiRouter } from '../network/rest-api'
import { ProgressStore } from './progress-store'
import type { ReplayRecorder } from '../core/replay-recorder'

async function main(): Promise<void> {
  const config = {
    ...createServerConfig(),
    authRequired: true,
    authTokens: [{ token: 'encyclopedia-token', playerId: 'encyclopedia-http-player', playerName: 'Encyclopedia', playerKind: 'human' as const }],
  }
  const app = express()
  app.use(express.json())
  app.use('/api', createRestApiRouter(
    new GameEngine(config), new RoomManager(config), config,
    new ActionRateLimiter(1000, 100), {} as ReplayRecorder, null,
    new ProgressStore(), new PlayerAccountService(new MemoryPlayerAccountStore()),
  ))
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/api/account/encyclopedia`
  try {
    const unauthorized = await fetch(endpoint)
    assert.equal(unauthorized.status, 401)
    const response = await fetch(endpoint, { headers: { Authorization: 'Bearer encyclopedia-token' } })
    assert.equal(response.status, 200)
    const body = await response.json() as { ok: boolean; encyclopedia?: Record<string, unknown> }
    assert.equal(body.ok, true)
    assert.ok(body.encyclopedia)
    assert.equal(body.encyclopedia.schemaVersion, 1)
    assert.equal(body.encyclopedia.catalogVersion, 'encyclopedia-v1')
    assert.ok(Array.isArray(body.encyclopedia.generals))
    assert.ok(Array.isArray(body.encyclopedia.minions))
    assert.ok(Array.isArray(body.encyclopedia.bosses))
    const minions = body.encyclopedia.minions as Array<Record<string, unknown>>
    const bosses = body.encyclopedia.bosses as Array<Record<string, unknown>>
    assert.ok(minions.length > 0, 'HTTP projection must include the full PVE V2 monster catalog')
    assert.ok(bosses.length > 0, 'HTTP projection must include the full PVE V2 Boss catalog')
    assert.equal(minions.every((entry) => entry.unlocked === false), true, 'new account monsters start grey/locked')
    assert.equal(bosses.every((entry) => entry.unlocked === false), true, 'new account Bosses start grey/locked')
    const general = (body.encyclopedia.generals as Array<Record<string, unknown>>)[0]
    assert.equal(typeof general.unlocked, 'boolean')

    // The primary account envelope consumed by the frontend must carry the
    // same projection (the dedicated endpoint is only a compatibility path).
    const accountResponse = await fetch(`http://127.0.0.1:${address.port}/api/account`, {
      headers: { Authorization: 'Bearer encyclopedia-token' },
    })
    assert.equal(accountResponse.status, 200)
    const accountBody = await accountResponse.json() as { ok: boolean; encyclopedia?: { minions?: unknown[]; bosses?: unknown[] } }
    assert.equal(accountBody.ok, true)
    assert.ok(accountBody.encyclopedia, 'primary account envelope must include encyclopedia')
    assert.equal(accountBody.encyclopedia?.minions?.length, minions.length)
    assert.equal(accountBody.encyclopedia?.bosses?.length, bosses.length)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  console.log('encyclopedia HTTP smoke checks passed')
}

void main()
