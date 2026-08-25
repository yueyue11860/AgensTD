import type {
  DurablePveActionCommand,
  DurablePveActionRecord,
  PveMatchCheckpoint,
  PveMatchLease,
  ReserveActionResult,
} from './types'
import { PveCheckpointStoreError, type PveCheckpointStore } from './store'

const clone = <T>(value: T): T => structuredClone(value)

export class MemoryPveCheckpointStore implements PveCheckpointStore {
  private readonly leases = new Map<string, PveMatchLease>()
  private readonly checkpoints = new Map<string, PveMatchCheckpoint>()
  private readonly actions = new Map<string, DurablePveActionRecord[]>()
  private actionSequence = 0

  constructor(private readonly now: () => number = Date.now) {}

  isEnabled(): boolean { return true }

  async claimLease(input: { matchId: string; roomId: string; holderId: string; ttlMs: number }): Promise<PveMatchLease> {
    const previous = this.leases.get(input.matchId)
    const previousExpiresAt = previous ? Date.parse(previous.leaseExpiresAt) : 0
    const sameOwner = previous?.holderId === input.holderId && previous.roomId === input.roomId
    if (previous && previousExpiresAt > this.now() && !sameOwner) {
      throw new PveCheckpointStoreError('LEASE_FENCED', 'PVE lease is still held by another process')
    }
    const lease: PveMatchLease = {
      matchId: input.matchId,
      roomId: input.roomId,
      holderId: input.holderId,
      generation: previous
        ? sameOwner && previousExpiresAt > this.now()
          ? previous.generation
          : previous.generation + 1
        : 1,
      leaseExpiresAt: new Date(this.now() + input.ttlMs).toISOString(),
    }
    this.leases.set(input.matchId, clone(lease))
    return clone(lease)
  }

  async renewLease(lease: PveMatchLease, ttlMs: number): Promise<PveMatchLease> {
    this.assertLease(lease)
    const renewed = { ...lease, leaseExpiresAt: new Date(this.now() + ttlMs).toISOString() }
    this.leases.set(lease.matchId, clone(renewed))
    return clone(renewed)
  }

  async loadCheckpoint(matchId: string): Promise<PveMatchCheckpoint | null> {
    const checkpoint = this.checkpoints.get(matchId)
    return checkpoint ? clone(checkpoint) : null
  }

  async loadLatestCheckpointForRoom(roomId: string): Promise<PveMatchCheckpoint | null> {
    const checkpoint = [...this.checkpoints.values()]
      .filter((candidate) => candidate.roomId === roomId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
    return checkpoint ? clone(checkpoint) : null
  }

  async listLatestCheckpoints(limit = 1000): Promise<readonly PveMatchCheckpoint[]> {
    const latestByRoom = new Map<string, PveMatchCheckpoint>()
    for (const checkpoint of [...this.checkpoints.values()]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))) {
      if (!latestByRoom.has(checkpoint.roomId)) latestByRoom.set(checkpoint.roomId, checkpoint)
    }
    return [...latestByRoom.values()].slice(0, limit).map(clone)
  }

  async saveCheckpoint(lease: PveMatchLease, checkpoint: Omit<PveMatchCheckpoint, 'generation'>): Promise<PveMatchCheckpoint> {
    this.assertLease(lease)
    if (checkpoint.matchId !== lease.matchId || checkpoint.roomId !== lease.roomId) {
      throw new PveCheckpointStoreError('CHECKPOINT_CONFLICT', 'Checkpoint identity does not match lease')
    }
    const previous = this.checkpoints.get(checkpoint.matchId)
    if (previous && previous.generation === lease.generation && previous.checkpointTick > checkpoint.checkpointTick) {
      throw new PveCheckpointStoreError('CHECKPOINT_CONFLICT', 'Checkpoint tick moved backwards')
    }
    const stored = { ...clone(checkpoint), generation: lease.generation }
    this.checkpoints.set(checkpoint.matchId, stored)
    return clone(stored)
  }

  async getAction(matchId: string, playerId: string, requestId: string): Promise<DurablePveActionRecord | null> {
    const action = (this.actions.get(matchId) ?? []).find((candidate) => (
      candidate.playerId === playerId && candidate.requestId === requestId
    ))
    return action ? clone(action) : null
  }

  async reserveAction(lease: PveMatchLease, command: DurablePveActionCommand, leaseTtlMs: number): Promise<ReserveActionResult> {
    this.assertLease(lease)
    this.leases.set(lease.matchId, { ...clone(lease), leaseExpiresAt: new Date(this.now() + leaseTtlMs).toISOString() })
    if (command.matchId !== lease.matchId || command.roomId !== lease.roomId) {
      throw new PveCheckpointStoreError('ACTION_CONFLICT', 'Action identity does not match lease')
    }
    const existing = await this.getAction(command.matchId, command.playerId, command.requestId)
    if (existing) return { status: existing.fingerprint === command.fingerprint ? 'duplicate' : 'conflict', record: existing }
    this.actionSequence += 1
    const record: DurablePveActionRecord = {
      ...clone(command),
      actionSequence: this.actionSequence,
      generation: lease.generation,
      createdAt: new Date(this.now()).toISOString(),
    }
    const actions = this.actions.get(command.matchId) ?? []
    actions.push(record)
    this.actions.set(command.matchId, actions)
    return { status: 'reserved', record: clone(record) }
  }

  async listActionsAfter(matchId: string, actionSequence: number, limit = 1000): Promise<readonly DurablePveActionRecord[]> {
    return (this.actions.get(matchId) ?? [])
      .filter((action) => action.actionSequence > actionSequence)
      .sort((left, right) => left.actionSequence - right.actionSequence)
      .slice(0, limit)
      .map(clone)
  }

  private assertLease(candidate: PveMatchLease): void {
    const current = this.leases.get(candidate.matchId)
    if (!current
      || current.holderId !== candidate.holderId
      || current.generation !== candidate.generation
      || Date.parse(current.leaseExpiresAt) <= this.now()) {
      throw new PveCheckpointStoreError('LEASE_FENCED', `Lease generation ${candidate.generation} is no longer authoritative`)
    }
  }
}
