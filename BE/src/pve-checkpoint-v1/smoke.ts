import assert from 'node:assert/strict'
import { createServerConfig } from '../config/server-config'
import { Room } from '../core/Room'
import type { ClientAction, PlayerIdentity } from '../domain/actions'
import { hashPveCheckpointPayload } from './hash'
import { MemoryPveCheckpointStore } from './memory-store'
import { PveCheckpointCoordinator } from './coordinator'
import { ActionRateLimiter } from '../network/action-rate-limiter'
import { submitDurablePveAction } from '../network/action-submission'
import { performance } from 'node:perf_hooks'
import type { PveMatchCheckpoint } from './types'

class StaleDiscoveryMemoryStore extends MemoryPveCheckpointStore {
  private staleRoomRead: PveMatchCheckpoint | null = null

  returnStaleCheckpointOnce(checkpoint: PveMatchCheckpoint): void {
    this.staleRoomRead = structuredClone(checkpoint)
  }

  override async loadLatestCheckpointForRoom(roomId: string): Promise<PveMatchCheckpoint | null> {
    if (this.staleRoomRead?.roomId === roomId) {
      const checkpoint = this.staleRoomRead
      this.staleRoomRead = null
      return structuredClone(checkpoint)
    }
    return super.loadLatestCheckpointForRoom(roomId)
  }
}

const player: PlayerIdentity = { playerId: 'checkpoint-player', playerName: 'Checkpoint Player', playerKind: 'human' }
const recruit = (expectedTrayRevision: number): ClientAction => ({ action: 'RECRUIT_BATCH', expectedTrayRevision })

function createRoom() {
  const config = { ...createServerConfig(), matchId: 'checkpoint-process-restart', tickRateMs: 100 }
  const room = new Room('checkpoint-room', config)
  assert.equal(room.joinPlayer(player.playerId), 'P1')
  room.engine.registerPlayer(player)
  room.ignitePveV2({ levelId: 1, difficulty: 'easy' })
  return room
}

async function reserveAndEnqueue(
  coordinator: PveCheckpointCoordinator,
  room: Room,
  requestId: string,
  action: ClientAction,
) {
  const reserved = await coordinator.reserveAction({ room, player, requestId, action, rateLimitRemaining: 2 })
  assert.equal(reserved.status, 'reserved')
  room.engine.enqueueDurableAction({
    player, action, requestId, actionId: reserved.record.actionId, rateLimitRemaining: reserved.record.rateLimitRemaining,
  })
  room.engine.tick()
  await coordinator.checkpointRoom(room.id)
  return reserved.record
}

async function main() {
  let now = Date.parse('2026-08-25T00:00:00.000Z')
  const store = new StaleDiscoveryMemoryStore(() => now)
  const firstRoom = createRoom()
  const first = new PveCheckpointCoordinator(store, {
    holderId: 'process-a', leaseTtlMs: 30_000, checkpointEveryTicks: 5,
  })
  await first.attachFreshRoom(firstRoom)
  const firstAction = await reserveAndEnqueue(first, firstRoom, 'recruit-1', recruit(0))
  assert.equal(firstRoom.engine.getStateSnapshot().pve?.players[0]?.rice, 5)
  const before = await store.loadLatestCheckpointForRoom(firstRoom.id)
  assert.ok(before)
  const beforeHash = hashPveCheckpointPayload(firstRoom.exportPveCheckpointPayload())
  assert.equal(before.stateHash, beforeHash)

  // A second healthy process cannot steal an unexpired lease and create two authorities.
  now += 1_000
  const prematureRoom = createRoom()
  const premature = new PveCheckpointCoordinator(store, { holderId: 'process-premature', leaseTtlMs: 30_000 })
  await assert.rejects(premature.recoverAndAttach(prematureRoom), /still held by another process/)

  // The old holder can commit one final autonomous tick before expiry. Recovery discovery is
  // forced stale to reproduce the read -> claim TOCTOU, and must re-read after claiming.
  firstRoom.engine.tick()
  await first.checkpointRoom(firstRoom.id)
  const finalBeforeExpiry = await store.loadCheckpoint(before.matchId)
  assert.ok(finalBeforeExpiry)
  assert.ok(finalBeforeExpiry.checkpointTick > before.checkpointTick)
  const finalBeforeExpiryHash = finalBeforeExpiry.stateHash

  // Store-level fencing contract: an active lease rejects takeover; after expiry generation
  // advances exactly once and the old holder cannot renew, reserve, or save.
  let fenceNow = 0
  const fenceStore = new MemoryPveCheckpointStore(() => fenceNow)
  const fenceLeaseA = await fenceStore.claimLease({ matchId: 'fence-match', roomId: 'fence-room', holderId: 'fence-a', ttlMs: 30_000 })
  await assert.rejects(
    fenceStore.claimLease({ matchId: 'fence-match', roomId: 'fence-room', holderId: 'fence-b', ttlMs: 30_000 }),
    /still held by another process/,
  )
  fenceNow = 30_001
  const fenceLeaseB = await fenceStore.claimLease({ matchId: 'fence-match', roomId: 'fence-room', holderId: 'fence-b', ttlMs: 30_000 })
  assert.equal(fenceLeaseB.generation, fenceLeaseA.generation + 1)
  await assert.rejects(fenceStore.renewLease(fenceLeaseA, 30_000), /no longer authoritative/)
  await assert.rejects(fenceStore.reserveAction(fenceLeaseA, {
    matchId: 'fence-match', roomId: 'fence-room', playerId: player.playerId, requestId: 'fenced-reserve',
    actionId: 'fenced-action', fingerprint: '{}', payload: {}, serverTick: 0, rateLimitRemaining: 1,
  }, 30_000), /no longer authoritative/)
  const { generation: _generation, ...checkpointWithoutGeneration } = finalBeforeExpiry
  await assert.rejects(fenceStore.saveCheckpoint(fenceLeaseA, {
    ...checkpointWithoutGeneration, matchId: 'fence-match', roomId: 'fence-room',
  }), /no longer authoritative/)

  store.returnStaleCheckpointOnce(before)
  now += 30_001
  const secondRoom = createRoom()
  const second = new PveCheckpointCoordinator(store, { holderId: 'process-b', leaseTtlMs: 30_000, checkpointEveryTicks: 5 })
  const recovered = await second.recoverAndAttach(secondRoom)
  assert.equal(recovered.recovered, true)
  assert.equal(recovered.replayedActions, 0)
  assert.equal(recovered.stateHash, finalBeforeExpiryHash)
  const recoveredPayloadHash = hashPveCheckpointPayload(secondRoom.exportPveCheckpointPayload())
  assert.equal(recoveredPayloadHash, finalBeforeExpiryHash,
    'claim must be followed by a fresh checkpoint read so the final pre-expiry commit is restored')
  assert.deepEqual(secondRoom.engine.getStateSnapshot().pve?.recentEvents, [], 'historical combat VFX/events are not replayed')
  assert.equal(secondRoom.engine.getStateSnapshot().pve?.players[0]?.rice, 5)

  // Generation fencing applies to every mutation path, not checkpoint writes alone.
  await assert.rejects(first.checkpointRoom(firstRoom.id), /no longer authoritative/)

  const duplicate = await second.reserveAction({ room: secondRoom, player, requestId: 'recruit-1', action: recruit(0), rateLimitRemaining: 2 })
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.record.actionId, firstAction.actionId)
  const conflict = await second.reserveAction({ room: secondRoom, player, requestId: 'recruit-1', action: recruit(1), rateLimitRemaining: 2 })
  assert.equal(conflict.status, 'conflict')

  // Simulate a crash after durable reservation but before application/checkpoint.
  const pending = await second.reserveAction({ room: secondRoom, player, requestId: 'recruit-2', action: recruit(1), rateLimitRemaining: 1 })
  assert.equal(pending.status, 'reserved')
  now += 30_001
  const thirdRoom = createRoom()
  const third = new PveCheckpointCoordinator(store, { holderId: 'process-c', leaseTtlMs: 30_000, checkpointEveryTicks: 5 })
  const replayed = await third.recoverAndAttach(thirdRoom)
  assert.equal(replayed.replayedActions, 1)
  assert.equal(thirdRoom.engine.getStateSnapshot().pve?.players[0]?.recruitSequence, 2)
  assert.equal(thirdRoom.engine.getStateSnapshot().pve?.players[0]?.rice, 0)
  assert.deepEqual(thirdRoom.engine.getStateSnapshot().pve?.recentEvents, [], 'replayed command events are suppressed before clients attach')
  const replayCheckpoint = await store.loadCheckpoint(thirdRoom.engine.getStateSnapshot().matchId)
  assert.equal(replayCheckpoint?.lastActionSequence, pending.record.actionSequence,
    'recovery must advance the durable cursor even though runtime listeners are not attached yet')
  const replayDuplicate = await third.reserveAction({ room: thirdRoom, player, requestId: 'recruit-2', action: recruit(1), rateLimitRemaining: 1 })
  assert.equal(replayDuplicate.status, 'duplicate')

  const missingRequest = await submitDurablePveAction({
    engine: thirdRoom.engine, room: thirdRoom, checkpointCoordinator: third,
    limiter: new ActionRateLimiter(1_000, 100), player, payload: { action: 'RECRUIT_BATCH', expectedTrayRevision: 2 },
  })
  assert.equal(missingRequest.ok, false)
  if (!missingRequest.ok) assert.equal(missingRequest.code, 'REQUEST_ID_REQUIRED')
  const entryPayload = { requestId: 'entry-action', payload: { action: 'RECRUIT_BATCH', expectedTrayRevision: 2 } }
  const entryAccepted = await submitDurablePveAction({
    engine: thirdRoom.engine, room: thirdRoom, checkpointCoordinator: third,
    limiter: new ActionRateLimiter(1_000, 100), player, payload: entryPayload,
  })
  assert.equal(entryAccepted.ok, true)
  thirdRoom.engine.applyRecoveredActions()
  await third.checkpointRoom(thirdRoom.id)
  const entryDuplicate = await submitDurablePveAction({
    engine: thirdRoom.engine, room: thirdRoom, checkpointCoordinator: third,
    limiter: new ActionRateLimiter(1_000, 100), player, payload: entryPayload,
  })
  assert.equal(entryDuplicate.ok, true)
  if (entryDuplicate.ok) assert.equal(entryDuplicate.duplicate, true)

  now += 30_001
  const fourthRoom = createRoom()
  const fourth = new PveCheckpointCoordinator(store, { holderId: 'process-d', leaseTtlMs: 30_000, checkpointEveryTicks: 5 })
  const replayGuard = await fourth.recoverAndAttach(fourthRoom)
  assert.equal(replayGuard.replayedActions, 0, 'a checkpointed recovery must not enqueue historical journal rows again')

  // Superseded generation is fenced from future writes.
  await assert.rejects(second.checkpointRoom(secondRoom.id), /no longer authoritative/)

  // Logic-only benchmark: no network/Postgres RTT, never use as a production latency claim.
  now += 30_001
  const benchmarkRoom = createRoom()
  const benchmark = new PveCheckpointCoordinator(store, { holderId: 'benchmark', leaseTtlMs: 30_000 })
  await benchmark.attachFreshRoom(benchmarkRoom)
  const reserveDurations: number[] = []
  const benchmarkStarted = performance.now()
  for (let index = 0; index < 200; index += 1) {
    const started = performance.now()
    await benchmark.reserveAction({
      room: benchmarkRoom, player, requestId: `benchmark-${index}`, action: recruit(0), rateLimitRemaining: 1000,
    })
    reserveDurations.push(performance.now() - started)
  }
  const elapsed = performance.now() - benchmarkStarted
  const sorted = reserveDurations.slice().sort((left, right) => left - right)
  const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!
  const logicBenchmark = {
    sampleSize: sorted.length,
    p50Ms: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    p99Ms: Number(percentile(0.99).toFixed(3)),
    throughputOpsPerSec: Number((sorted.length * 1000 / elapsed).toFixed(1)),
    scope: 'memory-store-logic-only-no-network-rtt',
  }

  first.shutdown()
  second.shutdown()
  third.shutdown()
  fourth.shutdown()
  await benchmark.flushAndShutdown()
  const finalShutdownCheckpoint = await store.loadLatestCheckpointForRoom(benchmarkRoom.id)
  assert.ok(finalShutdownCheckpoint, 'graceful shutdown must persist the final PVE checkpoint before exit')
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stateHashBeforeRecovery: finalBeforeExpiryHash,
    stateHashAfterRecovery: recoveredPayloadHash,
    activeLeaseTakeoverRejected: true,
    postClaimCheckpointReload: true,
    generationFencing: true,
    pendingActionReplay: true,
    actionIdempotency: true,
    historicalVfxSuppressed: true,
    durableSubmissionEntry: true,
    reservePathRemoteRttBudget: 1,
    logicBenchmark,
  })}\n`)
}

void main()
