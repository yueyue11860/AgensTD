import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { createServerConfig } from '../config/server-config'
import { GameEngine } from '../core/game-engine'
import { RoomManager } from '../core/Room'
import { ProgressStore } from '../data/progress-store'
import { ActionRateLimiter } from './action-rate-limiter'
import { createRestApiRouter } from './rest-api'
import type { ReplayRecorder } from '../core/replay-recorder'
import { Room } from '../core/Room'

async function main() {
  const config = {
    ...createServerConfig(),
    authRequired: true,
    authTokens: [{ token: 'legacy-replay-token', playerId: 'legacy-player', playerName: 'Legacy Player', playerKind: 'human' as const }],
  }
  const progressStore = new ProgressStore()
  const securedRoom = new Room('security-room', config, { password: 'room-secret' })
  assert.equal(securedRoom.getSummary().hasPassword, true)
  assert.equal(securedRoom.verifyJoinPassword('wrong'), false)
  assert.equal(securedRoom.verifyJoinPassword('room-secret'), true)
  const app = express()
  app.use(express.json())
  app.use('/api', createRestApiRouter(
    new GameEngine(config), new RoomManager(config), config,
    new ActionRateLimiter(1000, 3), {} as ReplayRecorder, null, progressStore,
  ))
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  try {
    const roomResponse = await fetch(`http://127.0.0.1:${address.port}/api/rooms`, {
      method: 'POST',
      headers: { Authorization: 'Bearer legacy-replay-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'secured', password: 'room-secret' }),
    })
    assert.equal(roomResponse.status, 201)
    const roomPayload = await roomResponse.text()
    assert.match(roomPayload, /"hasPassword":true/)
    assert.equal(roomPayload.includes('room-secret'), false)
    assert.equal(roomPayload.includes('saltHex'), false)

    const response = await fetch(`http://127.0.0.1:${address.port}/api/replays`, {
      method: 'POST',
      headers: { Authorization: 'Bearer legacy-replay-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: 'forged-match', isVictory: true, level: 5 }),
    })
    assert.equal(response.status, 410)
    const payload = await response.json() as { ok: boolean; code: string; stored?: boolean }
    assert.equal(payload.ok, false)
    assert.equal(payload.code, 'LEGACY_REPLAY_DISABLED')
    assert.equal('stored' in payload, false)
    assert.equal(progressStore.getProgress('legacy-player'), undefined)

    const retry = await fetch(`http://127.0.0.1:${address.port}/api/replays`, {
      method: 'POST',
      headers: { Authorization: 'Bearer legacy-replay-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: 'forged-match', isVictory: true, level: 5 }),
    })
    assert.equal(retry.status, 410)
    assert.equal(progressStore.getProgress('legacy-player'), undefined)
    console.log('legacy replay security smoke passed')
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
