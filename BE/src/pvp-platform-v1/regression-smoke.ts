import assert from 'node:assert/strict'
import type { PvpMatchDetail } from '../../../shared/contracts/pvp-competition'
import { MemoryPvpStore } from '../data/memory-pvp-store'
import { PvpPlatformService } from './service'
import type { HumanGatewayPrincipal } from './types'

const principal = (playerId: string): HumanGatewayPrincipal => ({
  token: `token-${playerId}`, playerId, playerName: playerId, playerKind: 'human',
})

async function runActiveCheckpointSmoke(): Promise<void> {
  const store = new MemoryPvpStore()
  const platform = new PvpPlatformService({ store, autoTick: false })
  try {
    await platform.ready
    const alice = principal('checkpoint-a')
    const bob = principal('checkpoint-b')
    const room = platform.createRoom(alice, { roomName: 'checkpoint-room', password: 'secret', spectatorsAllowed: false })
    await platform.joinRoom(bob, room.roomId, 'secret')
    await platform.setRoomReady(alice, room.roomId, true)
    const ready = await platform.setRoomReady(bob, room.roomId, true)
    assert.ok(ready.matchId)
    let checkpoint = null
    for (let attempt = 0; attempt < 20 && !checkpoint; attempt += 1) {
      await new Promise<void>(resolve => setImmediate(resolve))
      checkpoint = await store.loadActiveMatchCheckpoint(ready.matchId!)
    }
    assert.ok(checkpoint, 'active match checkpoint must be persisted')
    assert.equal(checkpoint?.metadata.room?.roomName, 'checkpoint-room')
    assert.equal(checkpoint?.metadata.room?.passwordCredential !== null, true)
  } finally { platform.shutdown() }
}

async function main(): Promise<void> {
  await runActiveCheckpointSmoke()
  const platform = new PvpPlatformService({ store: new MemoryPvpStore(), autoTick: false })
  try {
    await platform.ready
    const alice = principal('load-failed-a')
    const bob = principal('load-failed-b')
    const room = platform.createRoom(alice, { roomName: 'load-failed-regression', spectatorsAllowed: false })
    await platform.joinRoom(bob, room.roomId)
    await platform.setRoomReady(alice, room.roomId, true)
    const ready = await platform.setRoomReady(bob, room.roomId, true)
    assert.ok(ready.matchId)
    const matchId = ready.matchId!
    const loading = platform.matchState(alice, matchId)
    const ack = platform.acknowledgeLoad(alice, matchId, {
      requestId: 'failed-load-once', status: 'failed', failureCode: 'ASSET_DECODE_FAILED',
      rulesetVersion: loading.loading.rulesetVersion, mapId: loading.loading.mapId,
      mapVersion: loading.loading.mapVersion, routeHash: loading.loading.routeHash,
      assetsVersion: loading.loading.assetsVersion,
    })
    assert.equal(ack.ok, true)
    assert.equal(platform.matchState(alice, matchId).phase, 'voided')
    // Settlement is scheduled by the failed ACK command because voided
    // runtimes are intentionally skipped by the normal tick loop.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise<void>(resolve => setImmediate(resolve))
      const detail = await platform.matchDetail(alice, matchId) as PvpMatchDetail
      if (detail.settlements.length === 2) {
        assert.equal(detail.match.status, 'no_contest')
        assert.equal(detail.match.endReason, 'load_failed')
        assert.equal(detail.participants.every(player => player.outcome === 'no_contest'), true)
        console.log('pvp-platform regression smoke passed')
        return
      }
    }
    throw new Error('load_failed settlement was not persisted')
  } finally {
    platform.shutdown()
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
