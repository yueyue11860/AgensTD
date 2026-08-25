import type {
  PveSettlementCommand,
  PveSettlementRecord,
  StoredPveRewardBatch,
} from './types'

export class PveRewardStoreConflictError extends Error {
  constructor(
    readonly code: 'REWARD_BATCH_CONFLICT' | 'SETTLEMENT_CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'PveRewardStoreConflictError'
  }
}

export interface PveRewardStore {
  isEnabled(): boolean
  getBatch(batchKey: string): Promise<StoredPveRewardBatch | null>
  recordBatch(batch: StoredPveRewardBatch): Promise<{ duplicate: boolean; batch: StoredPveRewardBatch }>
  listPlayerBatches(matchId: string, playerId: string): Promise<readonly StoredPveRewardBatch[]>
  prepareSettlement(command: PveSettlementCommand, fingerprint: string): Promise<PveSettlementRecord>
  markSettlementCommitted(
    settlementId: string,
    settlement: NonNullable<PveSettlementRecord['settlement']>,
    detail?: PveSettlementRecord['detail'],
  ): Promise<PveSettlementRecord>
  markSettlementFailed(settlementId: string, error: string): Promise<PveSettlementRecord>
  getSettlement(settlementId: string): Promise<PveSettlementRecord | null>
  listRecoverableSettlements(limit?: number): Promise<readonly PveSettlementRecord[]>
}
