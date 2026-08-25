export interface PlayerConnectionLease {
  playerId: string
  socketId: string
  generation: number
}

export interface PendingPlayerDisconnect extends PlayerConnectionLease {
  deadlineAt: number
}

export interface AttachConnectionResult {
  ok: boolean
  lease?: PlayerConnectionLease
  reconnected: boolean
  supersededSocketId: string | null
  reason?: 'DEPARTURE_IN_PROGRESS'
}

export interface DetachConnectionResult {
  startedGrace: boolean
  stale: boolean
  pending?: PendingPlayerDisconnect
}

interface PendingTimer extends PendingPlayerDisconnect {
  timer: ReturnType<typeof setTimeout>
}

export interface PlayerReconnectRegistryOptions {
  graceMs: number
  now?: () => number
  onGraceStarted?: (pending: PendingPlayerDisconnect) => void
  onExpired: (pending: PendingPlayerDisconnect) => void
}

/**
 * 房间内玩家连接租约。每个 playerId 只允许一个权威 socket，generation
 * 让旧 socket 的迟到 disconnect 无法影响更新的连接。
 */
export class PlayerReconnectRegistry {
  private readonly active = new Map<string, PlayerConnectionLease>()
  private readonly pending = new Map<string, PendingTimer>()
  private readonly generations = new Map<string, number>()
  private readonly departing = new Set<string>()
  private readonly now: () => number

  constructor(private readonly options: PlayerReconnectRegistryOptions) {
    this.now = options.now ?? Date.now
  }

  attach(playerId: string, socketId: string): AttachConnectionResult {
    if (this.departing.has(playerId)) {
      return { ok: false, reconnected: false, supersededSocketId: null, reason: 'DEPARTURE_IN_PROGRESS' }
    }

    const previous = this.active.get(playerId)
    const pending = this.pending.get(playerId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(playerId)
    }
    const generation = (this.generations.get(playerId) ?? 0) + 1
    this.generations.set(playerId, generation)
    const lease = { playerId, socketId, generation }
    this.active.set(playerId, lease)
    return {
      ok: true,
      lease,
      reconnected: Boolean(pending || previous),
      supersededSocketId: previous && previous.socketId !== socketId ? previous.socketId : null,
    }
  }

  detach(playerId: string, socketId: string, generation: number): DetachConnectionResult {
    const active = this.active.get(playerId)
    if (!active || active.socketId !== socketId || active.generation !== generation) {
      return { startedGrace: false, stale: true }
    }
    this.active.delete(playerId)
    const deadlineAt = this.now() + this.options.graceMs
    const pending: PendingTimer = {
      ...active,
      deadlineAt,
      timer: setTimeout(() => this.expire(active, deadlineAt), this.options.graceMs),
    }
    this.pending.set(playerId, pending)
    const publicPending = this.publicPending(pending)
    this.options.onGraceStarted?.(publicPending)
    return { startedGrace: true, stale: false, pending: publicPending }
  }

  isCurrent(playerId: string, socketId: string, generation: number): boolean {
    const active = this.active.get(playerId)
    return active?.socketId === socketId && active.generation === generation
  }

  getPending(playerId: string): PendingPlayerDisconnect | null {
    const pending = this.pending.get(playerId)
    return pending ? this.publicPending(pending) : null
  }

  completeDeparture(playerId: string): void {
    this.departing.delete(playerId)
  }

  shutdown(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear()
    this.active.clear()
    this.departing.clear()
  }

  private expire(lease: PlayerConnectionLease, deadlineAt: number): void {
    const pending = this.pending.get(lease.playerId)
    if (!pending || pending.socketId !== lease.socketId || pending.generation !== lease.generation) return
    if (this.generations.get(lease.playerId) !== lease.generation || this.active.has(lease.playerId)) return
    this.pending.delete(lease.playerId)
    this.departing.add(lease.playerId)
    this.options.onExpired({ ...lease, deadlineAt })
  }

  private publicPending(pending: PendingTimer): PendingPlayerDisconnect {
    const { timer: _timer, ...value } = pending
    return value
  }
}
