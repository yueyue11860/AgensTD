import type { PveSettlementCommand, PveSettlementRecord, StoredPveRewardBatch } from './types'
import { PveRewardStoreConflictError, type PveRewardStore } from './store'

const clone = <T>(value: T): T => structuredClone(value)
const nowIso = () => new Date().toISOString()

/** 与 Supabase 适配器保持相同幂等/冲突语义的开发与测试存储。 */
export class MemoryPveRewardStore implements PveRewardStore {
  private readonly batches = new Map<string, StoredPveRewardBatch>()
  private readonly settlements = new Map<string, PveSettlementRecord>()

  isEnabled(): boolean { return true }

  async getBatch(batchKey: string): Promise<StoredPveRewardBatch | null> {
    const value = this.batches.get(batchKey)
    return value ? clone(value) : null
  }

  async recordBatch(batch: StoredPveRewardBatch): Promise<{ duplicate: boolean; batch: StoredPveRewardBatch }> {
    const existing = this.batches.get(batch.batchKey)
    if (existing) {
      if (existing.fingerprint !== batch.fingerprint) {
        throw new PveRewardStoreConflictError('REWARD_BATCH_CONFLICT', `Reward batch ${batch.batchKey} conflicts with stored facts`)
      }
      return { duplicate: true, batch: clone(existing) }
    }
    this.batches.set(batch.batchKey, clone(batch))
    return { duplicate: false, batch: clone(batch) }
  }

  async listPlayerBatches(matchId: string, playerId: string): Promise<readonly StoredPveRewardBatch[]> {
    return [...this.batches.values()]
      .filter(batch => batch.matchId === matchId && batch.playerId === playerId)
      .sort((left, right) => left.batchKey.localeCompare(right.batchKey))
      .map(clone)
  }

  async prepareSettlement(command: PveSettlementCommand, fingerprint: string): Promise<PveSettlementRecord> {
    const existing = this.settlements.get(command.settlementId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new PveRewardStoreConflictError('SETTLEMENT_CONFLICT', `Settlement ${command.settlementId} conflicts with stored facts`)
      }
      if (existing.status === 'committed') return clone(existing)
      const retried = { ...existing, status: 'pending' as const, attempts: existing.attempts + 1, updatedAt: nowIso() }
      this.settlements.set(command.settlementId, clone(retried))
      return clone(retried)
    }
    const at = nowIso()
    const created: PveSettlementRecord = {
      ...clone(command), fingerprint, status: 'pending', attempts: 1, lastError: null,
      settlement: null, createdAt: at, updatedAt: at,
    }
    this.settlements.set(command.settlementId, clone(created))
    return clone(created)
  }

  async markSettlementCommitted(settlementId: string, settlement: NonNullable<PveSettlementRecord['settlement']>, detail?: PveSettlementRecord['detail']): Promise<PveSettlementRecord> {
    const current = this.requireSettlement(settlementId)
    const next = { ...current, status: 'committed' as const, lastError: null, settlement: clone(settlement), ...(detail ? { detail: clone(detail) } : {}), updatedAt: nowIso() }
    this.settlements.set(settlementId, clone(next))
    return clone(next)
  }

  async markSettlementFailed(settlementId: string, error: string): Promise<PveSettlementRecord> {
    const current = this.requireSettlement(settlementId)
    if (current.status === 'committed') return clone(current)
    const next = { ...current, status: 'failed' as const, lastError: error.slice(0, 2000), updatedAt: nowIso() }
    this.settlements.set(settlementId, clone(next))
    return clone(next)
  }

  async getSettlement(settlementId: string): Promise<PveSettlementRecord | null> {
    const value = this.settlements.get(settlementId)
    return value ? clone(value) : null
  }

  async listRecoverableSettlements(limit = 100): Promise<readonly PveSettlementRecord[]> {
    return [...this.settlements.values()]
      .filter(record => record.status !== 'committed')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, limit)
      .map(clone)
  }

  private requireSettlement(settlementId: string): PveSettlementRecord {
    const value = this.settlements.get(settlementId)
    if (!value) throw new Error(`Settlement ${settlementId} is missing`)
    return value
  }
}
