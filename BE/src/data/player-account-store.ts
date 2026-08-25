import type { PlayerAccountRecord } from '../account-v1/types'

export interface PlayerAccountStore {
  isEnabled(): boolean
  get(playerId: string): Promise<PlayerAccountRecord | null>
  createIfAbsent(account: PlayerAccountRecord): Promise<PlayerAccountRecord>
  /**
   * 以 version 为 CAS 条件原子替换整个账户。版本不符时返回 false，
   * 调用方必须重读，不能盲目覆盖。
   */
  compareAndSwap(
    playerId: string,
    expectedVersion: number,
    next: PlayerAccountRecord,
  ): Promise<boolean>
}

