import type { PvpRewardOutboxEvent } from '../../../shared/contracts/pvp-competition'
import type { PvpStore } from '../data/pvp-store'

/**
 * Durable PVP reward outbox consumer. The store owns the lease and idempotency
 * boundary; this worker only claims, validates, and acknowledges events. Account
 * projections can safely be attached to `apply` without changing retry semantics.
 */
export interface PvpRewardOutboxWorkerOptions {
  workerId?: string
  pollIntervalMs?: number
  leaseMs?: number
  batchSize?: number
  apply?: (event: PvpRewardOutboxEvent) => Promise<void>
  now?: () => Date
}

export class PvpRewardOutboxWorker {
  private readonly workerId: string
  private readonly pollIntervalMs: number
  private readonly leaseMs: number
  private readonly batchSize: number
  private readonly apply: (event: PvpRewardOutboxEvent) => Promise<void>
  private readonly now: () => Date
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly store: PvpStore, options: PvpRewardOutboxWorkerOptions = {}) {
    this.workerId = options.workerId ?? `pvp-reward-worker:${process.pid}`
    this.pollIntervalMs = Math.max(50, Math.floor(options.pollIntervalMs ?? 1_000))
    this.leaseMs = Math.max(1_000, Math.floor(options.leaseMs ?? 30_000))
    this.batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize ?? 20)))
    this.apply = options.apply ?? (async () => undefined)
    this.now = options.now ?? (() => new Date())
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.drain().catch((error) => this.reportPollError(error))
    this.timer = setInterval(() => {
      void this.drain().catch((error) => this.reportPollError(error))
    }, this.pollIntervalMs)
    this.timer.unref?.()
  }

  async drain(): Promise<{ claimed: number; completed: number; failed: number }> {
    if (!this.running && this.timer) return { claimed: 0, completed: 0, failed: 0 }
    const at = this.now()
    const events = await this.store.claimRewardOutbox(this.workerId, this.batchSize, at.toISOString(), this.leaseMs)
    let completed = 0
    let failed = 0
    for (const event of events) {
      try {
        await this.apply(event)
        if (await this.store.completeRewardOutbox(event.eventId, this.workerId, this.now().toISOString())) completed += 1
      }
      catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        const delay = Math.min(60_000, 1_000 * 2 ** Math.min(event.attempts, 6))
        await this.store.failRewardOutbox(event.eventId, this.workerId, message, new Date(this.now().getTime() + delay).toISOString())
      }
    }
    return { claimed: events.length, completed, failed }
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    // Expired leases are intentionally reclaimed by the next worker instance.
  }

  private reportPollError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`PVP reward outbox poll failed: ${message}`)
  }
}
