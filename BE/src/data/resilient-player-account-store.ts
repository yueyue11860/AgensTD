import type { PlayerAccountRecord } from '../account-v1/types'
import type { PlayerAccountStore } from './player-account-store'

/**
 * Supabase 首次读写失败后粘性切换到内存库。
 *
 * 不会在一次进程内来回切换，避免一部分请求写 Supabase、另一部分
 * 请求写内存而造成账户分叉。重启服务后会重新尝试持久化库。
 */
export class ResilientPlayerAccountStore implements PlayerAccountStore {
  private useFallback = false
  private failureLogged = false
  private primaryObservedSuccess = false

  constructor(
    private readonly primary: PlayerAccountStore,
    private readonly fallback: PlayerAccountStore,
  ) {}

  isEnabled(): boolean {
    return true
  }

  async get(playerId: string): Promise<PlayerAccountRecord | null> {
    return this.run(
      () => this.primary.get(playerId),
      () => this.fallback.get(playerId),
    )
  }

  async createIfAbsent(account: PlayerAccountRecord): Promise<PlayerAccountRecord> {
    return this.run(
      () => this.primary.createIfAbsent(account),
      () => this.fallback.createIfAbsent(account),
    )
  }

  async compareAndSwap(
    playerId: string,
    expectedVersion: number,
    next: PlayerAccountRecord,
  ): Promise<boolean> {
    return this.run(
      () => this.primary.compareAndSwap(playerId, expectedVersion, next),
      () => this.fallback.compareAndSwap(playerId, expectedVersion, next),
    )
  }

  private async run<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (this.useFallback || !this.primary.isEnabled()) return fallback()
    try {
      const value = await primary()
      this.primaryObservedSuccess = true
      return value
    }
    catch (error) {
      // 一旦本进程观测到持久化库的成功读写，就不能再切到空内存库，
      // 否则会丢失已读账户或造成双写分叉。
      if (this.primaryObservedSuccess) throw error
      this.useFallback = true
      if (!this.failureLogged) {
        this.failureLogged = true
        const details = error instanceof Error ? error.message : String(error)
        console.error(`Player account persistence unavailable; using memory for this process: ${details}`)
      }
      return fallback()
    }
  }
}
