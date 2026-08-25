import type { PveMatchConfigSnapshot } from '../pve-v2/ruleset'

export const PVE_CHECKPOINT_SCHEMA_VERSION = 1 as const

export interface PveMatchLease {
  matchId: string
  roomId: string
  holderId: string
  generation: number
  leaseExpiresAt: string
}

export interface PveMatchCheckpoint {
  schemaVersion: typeof PVE_CHECKPOINT_SCHEMA_VERSION
  matchId: string
  roomId: string
  generation: number
  checkpointTick: number
  lastActionSequence: number
  combatRulesetVersion: string
  configSnapshot: PveMatchConfigSnapshot
  stateHash: string
  /** Versioned, JSON-compatible authoritative Room/GameEngine/PVE runtime payload. */
  payload: Record<string, unknown>
  createdAt: string
}

export interface DurablePveActionCommand {
  matchId: string
  roomId: string
  playerId: string
  requestId: string
  actionId: string
  fingerprint: string
  payload: Record<string, unknown>
  serverTick: number
  rateLimitRemaining: number
}

export interface DurablePveActionRecord extends DurablePveActionCommand {
  actionSequence: number
  generation: number
  createdAt: string
}

export type ReserveActionResult =
  | { status: 'reserved'; record: DurablePveActionRecord }
  | { status: 'duplicate'; record: DurablePveActionRecord }
  | { status: 'conflict'; record: DurablePveActionRecord }
