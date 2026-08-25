import type { PlayerAccountStore } from '../data/player-account-store'
import type { PlayerAccountRecord } from './types'

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** 与持久化存储保持一致 CAS 语义的内存实现。 */
export class MemoryPlayerAccountStore implements PlayerAccountStore {
  private readonly records = new Map<string, PlayerAccountRecord>()

  isEnabled(): boolean {
    return true
  }

  async get(playerId: string): Promise<PlayerAccountRecord | null> {
    const value = this.records.get(playerId)
    return value ? clone(value) : null
  }

  async createIfAbsent(account: PlayerAccountRecord): Promise<PlayerAccountRecord> {
    const existing = this.records.get(account.playerId)
    if (existing) return clone(existing)
    const stored = clone(account)
    this.records.set(account.playerId, stored)
    return clone(stored)
  }

  async compareAndSwap(
    playerId: string,
    expectedVersion: number,
    next: PlayerAccountRecord,
  ): Promise<boolean> {
    const current = this.records.get(playerId)
    if (!current || current.version !== expectedVersion) return false
    if (next.playerId !== playerId || next.version !== expectedVersion + 1) return false
    this.records.set(playerId, clone(next))
    return true
  }
}

