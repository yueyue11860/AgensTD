import type {
  PvpLeaderboardPage,
  PvpMatchDetail,
  PvpMatchHistoryPage,
  PvpMapCatalogEntry,
  PvpMatchmakingTicket,
  PvpModeDefinition,
  PvpModeId,
  PvpMatchParticipant,
  PvpMatchRecord,
  PvpPlayerSettlement,
  PvpRating,
  PvpRatingLedgerEntry,
  PvpReplayChunk,
  PvpReplayDetail,
  PvpReplayManifest,
  PvpRewardOutboxEvent,
  PvpSeason,
} from '../../../shared/contracts/pvp-competition'
import type { PvpRuntimeCheckpoint } from '../pvp-v1/runtime'

export interface PvpMatchLease {
  matchId: string
  holderId: string
  generation: number
  leaseExpiresAt: string
}

/** Durable authoritative image for an in-flight match. */
export interface PvpActiveMatchCheckpoint {
  schemaVersion: 1
  matchId: string
  generation: number
  checkpointTick: number
  stateHash: string
  runtime: PvpRuntimeCheckpoint
  metadata: {
    mode: string
    region: string
    seasonId: string
    createdAt: string
    participants: Array<{ playerId: string; playerName: string; side: 'A' | 'B'; loadoutVersion: number }>
    room?: {
      roomId: string
      roomName: string
      passwordCredential: Record<string, unknown> | null
      spectatorsAllowed: boolean
      createdAt: string
      hostPlayerId: string
      players: Array<Record<string, unknown>>
      matchId: string | null
    }
  }
  createdAt: string
}

export interface PreparedPvpPlayerSettlement {
  participant: PvpMatchParticipant
  nextRating: PvpRating
  settlement: PvpPlayerSettlement
  ledger: PvpRatingLedgerEntry | null
  outbox: PvpRewardOutboxEvent | null
  expectedRatingVersion: number
}

export interface PreparedPvpMatchSettlement {
  match: PvpMatchRecord
  players: readonly [PreparedPvpPlayerSettlement, PreparedPvpPlayerSettlement]
}

export type PvpSettlementCommitResult =
  | { status: 'committed' | 'duplicate'; detail: PvpMatchDetail }
  | { status: 'rating_conflict' }

export interface PvpLeaderboardQuery {
  seasonId: string
  modeId: PvpModeId
  limit: number
  cursor?: string | null
}

export interface PvpHistoryQuery {
  playerId: string
  seasonId?: string
  modeId?: PvpModeId
  limit: number
  cursor?: string | null
}

export interface PvpStore {
  isEnabled(): boolean

  upsertMode(mode: PvpModeDefinition): Promise<PvpModeDefinition>
  getMode(modeId: PvpModeId, version: string): Promise<PvpModeDefinition | null>
  listModes(enabledOnly?: boolean): Promise<PvpModeDefinition[]>
  upsertMap(map: PvpMapCatalogEntry): Promise<PvpMapCatalogEntry>
  getMap(mapId: string, version: string): Promise<PvpMapCatalogEntry | null>
  listMaps(status?: PvpMapCatalogEntry['status']): Promise<PvpMapCatalogEntry[]>

  createMatchmakingTicket(ticket: PvpMatchmakingTicket): Promise<PvpMatchmakingTicket>
  getMatchmakingTicket(ticketId: string): Promise<PvpMatchmakingTicket | null>
  transitionMatchmakingTicket(input: {
    ticketId: string
    expectedState: PvpMatchmakingTicket['state']
    nextState: PvpMatchmakingTicket['state']
    matchedMatchId?: string | null
    updatedAt: string
  }): Promise<PvpMatchmakingTicket | null>

  upsertSeason(season: PvpSeason): Promise<PvpSeason>
  getSeason(seasonId: string): Promise<PvpSeason | null>
  listSeasons(modeId?: string): Promise<PvpSeason[]>

  getRating(seasonId: string, modeId: PvpModeId, playerId: string): Promise<PvpRating | null>
  getLeaderboard(query: PvpLeaderboardQuery): Promise<PvpLeaderboardPage>
  listRatingLedger(playerId: string, seasonId: string, modeId: PvpModeId, limit: number): Promise<PvpRatingLedgerEntry[]>

  commitMatchSettlement(command: PreparedPvpMatchSettlement): Promise<PvpSettlementCommitResult>
  getMatchDetail(matchId: string): Promise<PvpMatchDetail | null>
  listMatchHistory(query: PvpHistoryQuery): Promise<PvpMatchHistoryPage>

  claimRewardOutbox(workerId: string, limit: number, now: string, leaseMs: number): Promise<PvpRewardOutboxEvent[]>
  completeRewardOutbox(eventId: string, workerId: string, completedAt: string): Promise<boolean>
  failRewardOutbox(eventId: string, workerId: string, error: string, retryAt: string): Promise<boolean>

  /** Process-fenced persistence for active PVP authority. */
  claimActiveMatchLease(input: { matchId: string; holderId: string; ttlMs: number }): Promise<PvpMatchLease>
  renewActiveMatchLease(lease: PvpMatchLease, ttlMs: number): Promise<PvpMatchLease>
  loadActiveMatchCheckpoint(matchId: string): Promise<PvpActiveMatchCheckpoint | null>
  listActiveMatchCheckpoints(limit?: number): Promise<readonly PvpActiveMatchCheckpoint[]>
  saveActiveMatchCheckpoint(lease: PvpMatchLease, checkpoint: Omit<PvpActiveMatchCheckpoint, 'generation'>): Promise<PvpActiveMatchCheckpoint>
  deleteActiveMatchCheckpoint(lease: PvpMatchLease): Promise<boolean>

  createReplayManifest(manifest: PvpReplayManifest): Promise<PvpReplayManifest>
  appendReplayChunk(chunk: PvpReplayChunk): Promise<PvpReplayChunk>
  finalizeReplay(matchId: string, chunkCount: number, actionCount: number, finalStateHash: string, updatedAt: string): Promise<PvpReplayManifest>
  getReplay(matchId: string): Promise<PvpReplayDetail | null>
}

export class PvpStoreError extends Error {
  constructor(
    readonly code:
      | 'SEASON_CONFLICT'
      | 'CATALOG_CONFLICT'
      | 'MATCHMAKING_CONFLICT'
      | 'SETTLEMENT_CONFLICT'
      | 'REPLAY_CONFLICT'
      | 'REPLAY_NOT_FOUND'
      | 'INVALID_REPLAY_CHUNK'
      | 'LEASE_FENCED'
      | 'CHECKPOINT_CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'PvpStoreError'
  }
}
