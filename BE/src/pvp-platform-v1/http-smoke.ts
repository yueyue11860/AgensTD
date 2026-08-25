import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import type { PvpMatchFound, PvpQueueTicket } from '../../../shared/contracts/pvp'
import { createServerConfig } from '../config/server-config'
import { MemoryPvpStore } from '../data/memory-pvp-store'
import { createPvpRestApiRouter } from '../network/pvp-rest-api'
import { PvpPlatformService } from './service'

interface Envelope {
  ok: boolean
  code?: string
  ticket?: PvpQueueTicket
  proposal?: PvpMatchFound
  match?: { matchId: string } | null
  state?: { phase: string }
  matches?: unknown[]
}

async function main(): Promise<void> {
  const platform = new PvpPlatformService({ store: new MemoryPvpStore(), autoTick: false })
  await platform.ready
  const config = {
    ...createServerConfig(),
    authRequired: true,
    authTokens: [
      { token: 'alice-token', playerId: 'alice-http', playerName: 'Alice HTTP', playerKind: 'human' as const },
      { token: 'bob-token', playerId: 'bob-http', playerName: 'Bob HTTP', playerKind: 'human' as const },
      { token: 'agent-token', playerId: 'agent-http', playerName: 'Agent HTTP', playerKind: 'agent' as const },
    ],
  }
  const app = express()
  app.use(express.json())
  app.use('/api/pvp', createPvpRestApiRouter(config, platform))
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const root = `http://127.0.0.1:${address.port}/api/pvp`

  const call = async (path: string, token: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${root}${path}`, { ...init, headers })
    return { status: response.status, body: await response.json() as Envelope }
  }

  try {
    const rejectedAgent = await call('/profile', 'agent-token')
    assert.equal(rejectedAgent.status, 403)
    assert.equal(rejectedAgent.body.code, 'HUMAN_ACCOUNT_REQUIRED')

    const join = (token: string, requestId: string, forgedPlayerId: string) => call('/queue', token, {
      method: 'POST',
      body: JSON.stringify({
        requestId,
        playerId: forgedPlayerId,
        playerName: 'forged',
        rating: 99999,
        mode: 'ranked_1v1',
        region: 'forged',
        rulesetVersion: 'current',
        loadoutVersion: 0,
      }),
    })
    const aliceJoin = await join('alice-token', 'http-queue-alice', 'bob-http')
    assert.equal(aliceJoin.status, 201)
    assert.equal(aliceJoin.body.ticket?.playerId, 'alice-http')
    assert.equal(aliceJoin.body.ticket?.region, 'auto')
    const bobJoin = await join('bob-token', 'http-queue-bob', 'alice-http')
    assert.equal(bobJoin.status, 201)
    const proposal = bobJoin.body.proposal
    assert.ok(proposal)

    const accept = (token: string, requestId: string) => call(`/proposals/${proposal.proposalId}/accept`, token, {
      method: 'POST', body: JSON.stringify({ requestId, playerId: 'forged-player' }),
    })
    assert.equal((await accept('alice-token', 'http-accept-alice')).body.match, null)
    const accepted = await accept('bob-token', 'http-accept-bob')
    const matchId = accepted.body.match?.matchId
    assert.ok(matchId)
    assert.equal((await call(`/matches/${matchId}/state`, 'alice-token')).body.state?.phase, 'countdown')
    for (let tick = 0; tick < 50; tick += 1) platform.tick()
    assert.equal((await call(`/matches/${matchId}/state`, 'alice-token')).body.state?.phase, 'playing')

    const surrendered = await call(`/matches/${matchId}/surrender`, 'bob-token', {
      method: 'POST', body: JSON.stringify({ requestId: 'http-surrender', playerId: 'alice-http' }),
    })
    assert.equal(surrendered.status, 200)
    const history = await call('/matches?limit=20', 'alice-token')
    assert.equal(history.status, 200)
    assert.equal(history.body.matches?.length, 1)

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const productionStaticToken = await call('/profile', 'alice-token')
      assert.equal(productionStaticToken.status, 401)
      assert.equal(productionStaticToken.body.code, 'OAUTH_SESSION_REQUIRED')
    }
    finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
    console.log('pvp-platform-v1 HTTP smoke passed')
  }
  finally {
    platform.shutdown()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
