import type {
  DurablePveActionCommand,
  DurablePveActionRecord,
  PveMatchCheckpoint,
  PveMatchLease,
  ReserveActionResult,
} from './types'

export class PveCheckpointStoreError extends Error {
  constructor(readonly code: 'LEASE_FENCED' | 'ACTION_CONFLICT' | 'CHECKPOINT_CONFLICT', message: string) {
    super(message)
    this.name = 'PveCheckpointStoreError'
  }
}

export interface PveCheckpointStore {
  isEnabled(): boolean
  claimLease(input: { matchId: string; roomId: string; holderId: string; ttlMs: number }): Promise<PveMatchLease>
  renewLease(lease: PveMatchLease, ttlMs: number): Promise<PveMatchLease>
  loadCheckpoint(matchId: string): Promise<PveMatchCheckpoint | null>
  loadLatestCheckpointForRoom(roomId: string): Promise<PveMatchCheckpoint | null>
  /** Latest checkpoint per room, used to discover every recoverable room during process bootstrap. */
  listLatestCheckpoints(limit?: number): Promise<readonly PveMatchCheckpoint[]>
  saveCheckpoint(lease: PveMatchLease, checkpoint: Omit<PveMatchCheckpoint, 'generation'>): Promise<PveMatchCheckpoint>
  getAction(matchId: string, playerId: string, requestId: string): Promise<DurablePveActionRecord | null>
  reserveAction(lease: PveMatchLease, command: DurablePveActionCommand, leaseTtlMs: number): Promise<ReserveActionResult>
  listActionsAfter(matchId: string, actionSequence: number, limit?: number): Promise<readonly DurablePveActionRecord[]>
}
