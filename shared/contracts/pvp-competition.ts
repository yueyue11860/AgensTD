/** PVP 竞技数据共享契约。战斗内实体由 pvp.ts 定义，本文件只管赛季、战绩、段位和回放持久化。 */

import type { PvpMode, PvpParticipantResult, PvpQueueTicketState, PvpResultReason, PvpSide as CorePvpSide } from './pvp'

export type PvpModeId = PvpMode
export type PvpMapId = string
export type PvpSide = CorePvpSide

export type PvpSeasonStatus = 'scheduled' | 'active' | 'locked' | 'archived'
export type PvpMatchStatus = 'finished' | 'no_contest'
export type PvpIntegrityStatus = 'valid' | 'invalid' | 'unverified'
export type PvpOutcome = Exclude<PvpParticipantResult, 'void'> | 'no_contest'
export type PvpEndReason = PvpResultReason

export type PvpRankTier =
  | 'unranked'
  | 'black_iron'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'amethyst'
  | 'great_sage'
  | 'victorious_fighting_buddha'

export type PvpRewardStatus = 'not_applicable' | 'pending' | 'processing' | 'committed' | 'failed'

export interface PvpModeDefinition {
  modeId: PvpModeId
  version: string
  name: string
  teamSize: number
  ranked: boolean
  /** 10000=全额，5000=半额，0=禁止可交易奖励/Outbox。 */
  rewardScaleBps: number
  rulesetVersion: string
  mapPoolVersion: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface PvpMapCatalogEntry {
  mapId: PvpMapId
  version: string
  name: string
  config: Record<string, unknown>
  checksum: string
  status: 'draft' | 'active' | 'retired'
  createdAt: string
  updatedAt: string
}

export interface PvpMatchmakingTicket {
  ticketId: string
  requestId: string
  playerId: string
  seasonId: string
  modeId: PvpModeId
  modeVersion: string
  region: string
  ratingSnapshot: number
  state: PvpQueueTicketState
  enqueuedAt: string
  expiresAt: string
  matchedMatchId: string | null
  updatedAt: string
}

export interface PvpSeason {
  seasonId: string
  modeId: PvpModeId
  modeVersion: string
  region: string
  name: string
  status: PvpSeasonStatus
  startsAt: string
  locksAt: string
  endsAt: string
  rankPolicyVersion: string
  rewardPolicyVersion: string
  createdAt: string
  updatedAt: string
}

export interface PvpRating {
  seasonId: string
  modeId: PvpModeId
  playerId: string
  rating: number
  leaguePoints: number
  tier: PvpRankTier
  division: number | null
  provisionalGames: number
  games: number
  wins: number
  losses: number
  draws: number
  streak: number
  version: number
  tierReachedAt: string
  updatedAt: string
}

export interface PvpLeaderboardEntry extends PvpRating {
  rank: number
  playerName: string
}

export interface PvpLeaderboardPage {
  seasonId: string
  modeId: PvpModeId
  entries: PvpLeaderboardEntry[]
  nextCursor: string | null
}

export interface PvpRulesetSnapshot {
  rulesetVersion: string
  catalogVersion: string
  effectSystemVersion: string
  mapId: PvpMapId
  mapVersion: string
  seed: string
}

export interface PvpMatchParticipant {
  matchId: string
  playerId: string
  playerName: string
  side: PvpSide
  slot: number
  outcome: PvpOutcome
  loadoutSnapshotId: string
  ratingBefore: number
  ratingDelta: number
  ratingAfter: number
  leaguePointsBefore: number
  leaguePointsDelta: number
  leaguePointsAfter: number
  tierBefore: PvpRankTier
  tierAfter: PvpRankTier
  disconnectedMs: number
  forfeited: boolean
  stats: Record<string, unknown>
}

export interface PvpMatchRecord extends PvpRulesetSnapshot {
  matchId: string
  seasonId: string
  modeId: PvpModeId
  modeVersion: string
  region: string
  status: PvpMatchStatus
  integrityStatus: PvpIntegrityStatus
  winnerSide: PvpSide | null
  endReason: PvpEndReason
  startedAt: string
  endedAt: string
  durationMs: number
  /** Rating/LP 已与战绩原子提交；该字段只表示账户奖励是否还在 Outbox 中。 */
  settlementStatus: 'rating_committed_reward_pending' | 'committed'
  settlementRequestId: string
  settlementFingerprint: string
  createdAt: string
  updatedAt: string
}

export interface PvpMatchDetail {
  match: PvpMatchRecord
  participants: PvpMatchParticipant[]
  settlements: PvpPlayerSettlement[]
}

export interface PvpMatchHistoryEntry {
  match: PvpMatchRecord
  self: PvpMatchParticipant
  opponents: PvpMatchParticipant[]
}

export interface PvpMatchHistoryPage {
  entries: PvpMatchHistoryEntry[]
  nextCursor: string | null
}

export interface PvpPlayerSettlement {
  settlementId: string
  matchId: string
  playerId: string
  requestId: string
  fingerprint: string
  outcome: PvpOutcome
  ratingBefore: number
  ratingDelta: number
  ratingAfter: number
  leaguePointsBefore: number
  leaguePointsDelta: number
  leaguePointsAfter: number
  tierBefore: PvpRankTier
  tierAfter: PvpRankTier
  reward: Record<string, unknown>
  rewardStatus: PvpRewardStatus
  committedAt: string
}

export interface PvpRatingLedgerEntry {
  ledgerId: string
  seasonId: string
  modeId: PvpModeId
  matchId: string
  playerId: string
  ratingBefore: number
  ratingDelta: number
  ratingAfter: number
  leaguePointsBefore: number
  leaguePointsDelta: number
  leaguePointsAfter: number
  policyVersion: string
  createdAt: string
}

export interface PvpRewardOutboxEvent {
  eventId: string
  matchId: string
  playerId: string
  eventType: 'pvp_match_reward'
  payload: Record<string, unknown>
  status: Exclude<PvpRewardStatus, 'not_applicable'>
  attempts: number
  availableAt: string
  leaseOwner: string | null
  leaseExpiresAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface PvpReplayManifest extends PvpRulesetSnapshot {
  matchId: string
  initialSnapshot: Record<string, unknown> | null
  initialSnapshotUri: string | null
  actionCount: number
  chunkCount: number
  finalStateHash: string | null
  visibility: 'participants' | 'public_delayed' | 'public'
  status: 'recording' | 'complete' | 'invalid'
  createdAt: string
  updatedAt: string
}

export interface PvpReplayChunk {
  matchId: string
  chunkIndex: number
  firstTick: number
  lastTick: number
  payload: Record<string, unknown> | null
  objectUri: string | null
  sha256: string
  createdAt: string
}

export interface PvpReplayDetail {
  manifest: PvpReplayManifest
  chunks: PvpReplayChunk[]
}
