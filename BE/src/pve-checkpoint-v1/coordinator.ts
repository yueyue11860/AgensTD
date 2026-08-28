import crypto from 'node:crypto'
import type { ClientAction, PlayerIdentity } from '../domain/actions'
import type { Room } from '../core/Room'
import { hashPveCheckpointPayload } from './hash'
import type { PveCheckpointStore } from './store'
import { PVE_CHECKPOINT_SCHEMA_VERSION, type DurablePveActionRecord, type PveMatchLease } from './types'

interface RoomContext {
  room: Room
  lease: PveMatchLease
  lastAppliedActionSequence: number
  actionSequenceById: Map<string, number>
  actionsByRequestKey: Map<string, DurablePveActionRecord>
  saveQueue: Promise<void>
  unsubscribeAction: () => void
  unsubscribeTick: () => void
  lastCheckpointTick: number
}

export interface PveCheckpointCoordinatorOptions {
  holderId?: string
  leaseTtlMs?: number
  checkpointEveryTicks?: number
  onFatal?: (error: unknown) => void
}

export class PveCheckpointCoordinator {
  readonly holderId: string
  private readonly leaseTtlMs: number
  private readonly checkpointEveryTicks: number
  private readonly contexts = new Map<string, RoomContext>()
  private fatalError: Error | null = null

  constructor(readonly store: PveCheckpointStore, private readonly options: PveCheckpointCoordinatorOptions = {}) {
    this.holderId = options.holderId ?? `pve-worker-${crypto.randomUUID()}`
    this.leaseTtlMs = Math.max(5_000, options.leaseTtlMs ?? 30_000)
    this.checkpointEveryTicks = Math.max(1, options.checkpointEveryTicks ?? 50)
  }

  isHealthy(): boolean { return this.fatalError === null }
  healthCode(): string | null { return this.fatalError ? 'PVE_CHECKPOINT_UNHEALTHY' : null }

  async recoverAndAttach(room: Room): Promise<{ recovered: boolean; replayedActions: number; stateHash: string | null }> {
    return this.runFatal(async () => {
      const discoveredCheckpoint = await this.store.loadLatestCheckpointForRoom(room.id)
      if (!discoveredCheckpoint) return { recovered: false, replayedActions: 0, stateHash: null }
      const checkpointState = ((discoveredCheckpoint.payload.engine as Record<string, unknown> | undefined)?.state as { status?: unknown } | undefined)
      if (checkpointState?.status === 'finished') return { recovered: false, replayedActions: 0, stateHash: null }
      if (hashPveCheckpointPayload(discoveredCheckpoint.payload) !== discoveredCheckpoint.stateHash) throw new Error('PVE_CHECKPOINT_HASH_MISMATCH')
      const lease = await this.store.claimLease({
        matchId: discoveredCheckpoint.matchId, roomId: room.id, holderId: this.holderId, ttlMs: this.leaseTtlMs,
      })
      // Discovery is deliberately outside the claim transaction. Re-read after fencing the old
      // holder so a final checkpoint committed immediately before lease expiry cannot be lost.
      const checkpoint = await this.store.loadCheckpoint(discoveredCheckpoint.matchId)
      if (!checkpoint || checkpoint.roomId !== room.id) throw new Error('PVE_CHECKPOINT_MISSING_AFTER_LEASE_CLAIM')
      if (checkpoint.generation > lease.generation) throw new Error('PVE_CHECKPOINT_GENERATION_AHEAD_OF_LEASE')
      if (hashPveCheckpointPayload(checkpoint.payload) !== checkpoint.stateHash) throw new Error('PVE_CHECKPOINT_HASH_MISMATCH')
      room.restorePveCheckpointPayload(checkpoint.payload)
      const context = this.createContext(room, lease, checkpoint.lastActionSequence, checkpoint.checkpointTick)
      const pending: DurablePveActionRecord[] = []
      let actionCursor = checkpoint.lastActionSequence
      while (true) {
        const batch = await this.store.listActionsAfter(checkpoint.matchId, actionCursor, 1000)
        if (batch.length === 0) break
        pending.push(...batch)
        const nextCursor = batch[batch.length - 1]!.actionSequence
        if (nextCursor <= actionCursor) throw new Error('PVE_DURABLE_ACTION_CURSOR_STALLED')
        actionCursor = nextCursor
        if (batch.length < 1000) break
      }
      for (const action of pending) {
        this.enqueueRecoveredAction(context, action)
      }
      if (pending.length > 0) {
        room.engine.applyRecoveredActions()
        // Recovery is synchronous and every queued record has now produced an authoritative
        // applied/rejected result. Listeners are intentionally not attached yet, so advance the
        // durable cursor explicitly or every subsequent restart would enqueue the same journal.
        context.lastAppliedActionSequence = actionCursor
        for (const action of pending) context.actionSequenceById.delete(action.actionId)
      }
      room.engine.discardRecoveredPresentationEvents()
      await this.saveNow(context)
      this.attachListeners(context)
      return { recovered: true, replayedActions: pending.length, stateHash: checkpoint.stateHash }
    })
  }

  async attachFreshRoom(room: Room): Promise<void> {
    await this.runFatal(async () => {
      const state = room.engine.getStateSnapshot()
      if (!state.pve?.configSnapshot || state.status === 'waiting') return
      const existing = this.contexts.get(room.id)
      if (existing?.lease.matchId === state.matchId) return
      if (existing) {
        existing.unsubscribeAction()
        existing.unsubscribeTick()
        this.contexts.delete(room.id)
      }
      const lease = await this.store.claimLease({
        matchId: state.matchId, roomId: room.id, holderId: this.holderId, ttlMs: this.leaseTtlMs,
      })
      const context = this.createContext(room, lease, 0, state.tick)
      await this.saveNow(context)
      this.attachListeners(context)
    })
  }

  async reserveAction(input: {
    room: Room
    player: PlayerIdentity
    requestId: string
    action: ClientAction
    rateLimitRemaining: number
  }) {
    return this.runFatal(async () => {
      let context = this.contexts.get(input.room.id)
      if (!context) {
        await this.attachFreshRoom(input.room)
        context = this.contexts.get(input.room.id)
      }
      if (!context) throw new Error('PVE_CHECKPOINT_CONTEXT_NOT_READY')
      const fingerprint = JSON.stringify(input.action)
      const actionId = `durable:${crypto.createHash('sha256')
        .update(`${context.lease.matchId}\0${input.player.playerId}\0${input.requestId}`)
        .digest('hex').slice(0, 32)}`
      const reserved = await this.store.reserveAction(context.lease, {
        matchId: context.lease.matchId,
        roomId: input.room.id,
        playerId: input.player.playerId,
        requestId: input.requestId,
        actionId,
        fingerprint,
        payload: { player: structuredClone(input.player), action: structuredClone(input.action) },
        serverTick: input.room.engine.getStateSnapshot().tick,
        rateLimitRemaining: input.rateLimitRemaining,
      }, this.leaseTtlMs)
      context.actionsByRequestKey.set(`${input.player.playerId}\0${input.requestId}`, reserved.record)
      if (reserved.status === 'reserved') context.actionSequenceById.set(actionId, reserved.record.actionSequence)
      return reserved
    })
  }

  async findAction(input: { room: Room; playerId: string; requestId: string; action: ClientAction }) {
    const context = this.contexts.get(input.room.id)
    if (!context) return null
    const previous = context.actionsByRequestKey.get(`${input.playerId}\0${input.requestId}`) ?? null
    if (!previous) return null
    return { status: previous.fingerprint === JSON.stringify(input.action) ? 'duplicate' as const : 'conflict' as const, record: previous }
  }

  async checkpointRoom(roomId: string): Promise<void> {
    await this.runFatal(async () => {
      const context = this.contexts.get(roomId)
      if (!context) throw new Error('PVE_CHECKPOINT_CONTEXT_NOT_READY')
      await this.queueSave(context)
    })
  }

  /**
   * Stop accepting new listeners only after every attached room has committed
   * its latest authoritative state.  Shutdown callers should await this method
   * before flushing replay data or closing the process.
   */
  async flushAndShutdown(): Promise<void> {
    this.assertHealthy()
    const contexts = [...this.contexts.values()]
    try {
      await Promise.all(contexts.map((context) => this.queueSave(context)))
      this.assertHealthy()
    } finally {
      for (const context of contexts) {
        context.unsubscribeAction()
        context.unsubscribeTick()
      }
      this.contexts.clear()
    }
  }

  shutdown(): void {
    for (const context of this.contexts.values()) {
      context.unsubscribeAction()
      context.unsubscribeTick()
    }
    this.contexts.clear()
  }

  private createContext(room: Room, lease: PveMatchLease, lastActionSequence: number, checkpointTick: number): RoomContext {
    const context: RoomContext = {
      room, lease, lastAppliedActionSequence: lastActionSequence, actionSequenceById: new Map(), actionsByRequestKey: new Map(),
      saveQueue: Promise.resolve(), unsubscribeAction: () => {}, unsubscribeTick: () => {}, lastCheckpointTick: checkpointTick,
    }
    this.contexts.set(room.id, context)
    return context
  }

  private attachListeners(context: RoomContext): void {
    context.unsubscribeAction = context.room.engine.onPveActionApplied((action) => {
      const sequence = context.actionSequenceById.get(action.id)
      if (sequence !== undefined) {
        context.lastAppliedActionSequence = Math.max(context.lastAppliedActionSequence, sequence)
        context.actionSequenceById.delete(action.id)
      }
      void this.queueSave(context).catch(() => undefined)
    })
    context.unsubscribeTick = context.room.engine.onTick((state) => {
      if (state.tick - context.lastCheckpointTick < this.checkpointEveryTicks) return
      context.lastCheckpointTick = state.tick
      void this.queueSave(context).catch(() => undefined)
    }, { label: 'pve-authoritative-checkpoint' })
  }

  private enqueueRecoveredAction(context: RoomContext, record: DurablePveActionRecord): void {
    const payload = record.payload as { player?: PlayerIdentity, action?: ClientAction }
    if (!payload.player || !payload.action) throw new Error('PVE_DURABLE_ACTION_PAYLOAD_INVALID')
    context.actionSequenceById.set(record.actionId, record.actionSequence)
    context.actionsByRequestKey.set(`${record.playerId}\0${record.requestId}`, record)
    context.room.engine.enqueueDurableAction({
      player: structuredClone(payload.player), action: structuredClone(payload.action), requestId: record.requestId,
      actionId: record.actionId, rateLimitRemaining: record.rateLimitRemaining,
    })
  }

  private queueSave(context: RoomContext): Promise<void> {
    const payload = context.room.exportPveCheckpointPayload()
    const state = context.room.engine.getStateSnapshot()
    const lastActionSequence = context.lastAppliedActionSequence
    context.saveQueue = context.saveQueue.then(async () => {
      context.lease = await this.store.renewLease(context.lease, this.leaseTtlMs)
      await this.store.saveCheckpoint(context.lease, {
        schemaVersion: PVE_CHECKPOINT_SCHEMA_VERSION,
        matchId: state.matchId,
        roomId: context.room.id,
        checkpointTick: state.tick,
        lastActionSequence,
        combatRulesetVersion: state.pve!.combatRulesetVersion,
        configSnapshot: structuredClone(state.pve!.configSnapshot!),
        stateHash: hashPveCheckpointPayload(payload),
        payload,
        createdAt: new Date().toISOString(),
      })
    }).catch((error: unknown) => this.fail(error))
    return context.saveQueue
  }

  private async saveNow(context: RoomContext): Promise<void> {
    await this.queueSave(context)
    this.assertHealthy()
  }

  private fail(error: unknown): never {
    if (!this.fatalError) {
      this.fatalError = error instanceof Error ? error : new Error(String(error))
      this.options.onFatal?.(this.fatalError)
    }
    throw this.fatalError
  }

  private async runFatal<T>(operation: () => Promise<T>): Promise<T> {
    this.assertHealthy()
    try {
      return await operation()
    }
    catch (error) {
      return this.fail(error)
    }
  }

  private assertHealthy(): void {
    if (this.fatalError) throw this.fatalError
  }
}
