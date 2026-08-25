import assert from 'node:assert/strict'
import { createServerConfig } from '../config/server-config'
import { Room } from '../core/Room'
import { PlayerReconnectRegistry, type PendingPlayerDisconnect } from './reconnect-registry'

const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs))

async function runLeaseSemantics(): Promise<void> {
  const graceStarted: PendingPlayerDisconnect[] = []
  const expired: PendingPlayerDisconnect[] = []
  let settlementCalls = 0
  const registry = new PlayerReconnectRegistry({
    graceMs: 20,
    onGraceStarted: (pending) => graceStarted.push(pending),
    onExpired: (pending) => {
      expired.push(pending)
      settlementCalls += 1
    },
  })

  const first = registry.attach('player-1', 'socket-old')
  assert.equal(first.ok, true)
  assert.equal(first.reconnected, false)
  const second = registry.attach('player-1', 'socket-new')
  assert.equal(second.supersededSocketId, 'socket-old', 'new authenticated socket supersedes the old socket')
  assert.equal(second.reconnected, true)
  assert.ok(first.lease && second.lease)
  assert.equal(registry.detach('player-1', 'socket-old', first.lease.generation).stale, true,
    'late disconnect from old socket cannot start a grace timer')
  assert.equal(graceStarted.length, 0)

  const pending = registry.detach('player-1', 'socket-new', second.lease.generation)
  assert.equal(pending.startedGrace, true)
  assert.equal(graceStarted.length, 1)
  const reconnected = registry.attach('player-1', 'socket-reconnected')
  assert.equal(reconnected.reconnected, true)
  assert.ok(reconnected.lease)
  await wait(30)
  assert.equal(expired.length, 0, 'reconnect cancels the prior expiry callback')

  registry.detach('player-1', 'socket-reconnected', reconnected.lease.generation)
  await wait(30)
  assert.equal(expired.length, 1)
  assert.equal(settlementCalls, 1, 'expired generation schedules settlement exactly once')
  assert.equal(registry.detach('player-1', 'socket-reconnected', reconnected.lease.generation).stale, true)
  await wait(25)
  assert.equal(settlementCalls, 1, 'duplicate/late disconnect cannot resettle')
  assert.deepEqual(registry.attach('player-1', 'socket-too-late'), {
    ok: false, reconnected: false, supersededSocketId: null, reason: 'DEPARTURE_IN_PROGRESS',
  })
  registry.completeDeparture('player-1')
  assert.equal(registry.attach('player-1', 'socket-next-match').ok, true)
  registry.shutdown()
}

function runAuthoritativeStatePreservation(): void {
  const config = { ...createServerConfig(), disconnectGraceMs: 20 }
  const room = new Room('reconnect-smoke-room', config)
  assert.equal(room.joinPlayer('player-1'), 'P1')
  room.engine.registerPlayer({ playerId: 'player-1', playerName: 'Original', playerKind: 'human' })
  const before = room.engine.getStateSnapshot()
  const beforePvePlayer = before.pve?.players.find((player) => player.playerId === 'player-1')
  assert.ok(beforePvePlayer)

  room.engine.markPlayerReconnecting('player-1')
  assert.equal(room.engine.restorePlayerConnection({ playerId: 'player-1', playerName: 'Restored', playerKind: 'human' }), true)
  const after = room.engine.getStateSnapshot()
  assert.equal(after.players.filter((player) => player.id === 'player-1').length, 1, 'reconnect does not add a duplicate player')
  assert.deepEqual(after.pve?.players.find((player) => player.playerId === 'player-1'), beforePvePlayer,
    'reconnect preserves PVE economy, tray, board and build state')
  assert.equal(after.players.find((player) => player.id === 'player-1')?.connectionStatus, 'connected')
}

function runConfigurationSemantics(): void {
  const previous = { nodeEnv: process.env.NODE_ENV, grace: process.env.DISCONNECT_GRACE_MS }
  try {
    process.env.NODE_ENV = 'development'
    process.env.DISCONNECT_GRACE_MS = '25'
    assert.equal(createServerConfig().disconnectGraceMs, 25, 'tests may use a short grace period')
    process.env.NODE_ENV = 'production'
    process.env.DISCONNECT_GRACE_MS = '10'
    assert.equal(createServerConfig().disconnectGraceMs, 30_000, 'production minimum is 30 seconds')
    process.env.DISCONNECT_GRACE_MS = '90000'
    assert.equal(createServerConfig().disconnectGraceMs, 60_000, 'production maximum is 60 seconds')
    delete process.env.DISCONNECT_GRACE_MS
    assert.equal(createServerConfig().disconnectGraceMs, 45_000, 'default grace is 45 seconds')
  }
  finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.nodeEnv
    if (previous.grace === undefined) delete process.env.DISCONNECT_GRACE_MS
    else process.env.DISCONNECT_GRACE_MS = previous.grace
  }
}

async function main(): Promise<void> {
  await runLeaseSemantics()
  runAuthoritativeStatePreservation()
  runConfigurationSemantics()
  console.log(JSON.stringify({
    ok: true,
    dualSocketGenerationGate: true,
    reconnectPreservesAuthoritativeState: true,
    expiry: true,
    lateDisconnectIgnored: true,
    settlementExactlyOnce: true,
    productionGraceBoundsMs: [30_000, 60_000],
  }))
}

void main()
