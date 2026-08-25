import type {
  PvpAcceptedMatch,
  PvpMatchFound,
  PvpMatchPhase,
  PvpMode as SharedPvpMode,
  PvpParticipantResult,
  PvpQueueTicket as SharedPvpQueueTicket,
} from '../../shared/contracts/pvp'

export type PvpMode = SharedPvpMode
export type PvpMatchResult = PvpParticipantResult
export type PvpMatchStatus = PvpMatchPhase
export type PvpTier = '玄铁' | '青铜' | '白银' | '黄金' | '紫金' | '大圣' | '斗战胜佛' | '未定级'

export interface PvpSeason {
  seasonId: string
  name: string
  status: 'upcoming' | 'active' | 'settling' | 'completed'
  startsAt: string
  endsAt: string
  rulesetVersion: string
  mapIds: string[]
}

export interface PvpRating {
  tier: PvpTier
  division: string | null
  visibleLp: number
  rating: number
  wins: number
  losses: number
  draws: number
  streak: number
  placementGames: number
  peakLp: number
  rank: number | null
}

export interface PvpProfile {
  playerId: string
  playerName: string
  avatarUrl: string | null
  tutorialCompleted: boolean
  loadoutValid: boolean
  queuePenaltyUntil: string | null
  region: string
  rating: PvpRating
  recentMatchIds: string[]
}

export interface PvpLeaderboardEntry {
  rank: number
  playerId: string
  playerName: string
  avatarUrl: string | null
  tier: PvpTier
  division: string | null
  visibleLp: number
  rating: number
  wins: number
  losses: number
  draws: number
  winRate: number
  reachedAt: string
}

export interface PvpLeaderboard {
  seasonId: string
  scope: 'global' | 'friends' | 'region'
  entries: PvpLeaderboardEntry[]
  self: PvpLeaderboardEntry | null
  nextCursor: string | null
}

export interface PvpParticipantStats {
  playerId: string
  playerName: string
  side: 'A' | 'B'
  result: PvpMatchResult
  coreHpRemaining: number
  baseKills: number
  pressureKills: number
  leaks: number
  scriptureEarned: number
  scriptureSpent: number
  pressureSent: number
  pressureLeaked: number
  rationsEarned: number
  rationsSpent: number
  paidRecruitCount: number
  activeGeneralIds: string[]
  peakPopulation: number
  highestSoldierLevel: number
  damageDealt: number
  controlDurationMs: number
  tierBefore: PvpTier
  tierAfter: PvpTier
  lpBefore: number
  lpAfter: number
}

export interface PvpMatchSummary {
  matchId: string
  seasonId: string
  mode: PvpMode
  mapId: string
  mapName: string
  status: PvpMatchStatus
  result: PvpMatchResult
  resultReason: string
  opponentPlayerId: string | null
  opponentName: string
  startedAt: string
  endedAt: string | null
  durationMs: number
  lpDelta: number
  replayAvailable: boolean
}

export interface PvpMatchDetail extends PvpMatchSummary {
  mapVersion: string
  rulesetVersion: string
  winnerPlayerId: string | null
  participants: PvpParticipantStats[]
  rewards: Array<{ type: string; amount: number; label: string }>
  replayStatus: 'available' | 'processing' | 'expired' | 'restricted' | 'unavailable'
}

export interface PvpRoomPlayer {
  playerId: string
  playerName: string
  side: 'A' | 'B' | null
  ready: boolean
  connected: boolean
  isHost: boolean
  tier: PvpTier
  division: string | null
}

export interface PvpRoomSummary {
  roomId: string
  roomName: string
  mode: 'custom_1v1'
  status: PvpMatchStatus
  mapId: string
  mapName: string
  hasPassword: boolean
  spectatorsAllowed: boolean
  playerCount: number
  maxPlayers: number
  players: PvpRoomPlayer[]
  createdAt: string
  matchId: string | null
}

export interface PvpQueueTicket extends SharedPvpQueueTicket {
  estimatedWaitSeconds?: number
  searchRange?: number
  proposal?: PvpMatchFound | null
  acceptedMatch?: PvpAcceptedMatch | null
}

export type { PvpAcceptedMatch, PvpMatchFound }

export interface PvpMatchPublicState {
  matchId: string
  status: PvpMatchStatus
  mapId: string
  mapVersion: string
  rulesetVersion: string
  elapsedMs: number
  round: number
  disasterLevel: number
  self: { playerId: string; playerName: string; coreHp: number; rations: number; scripture: number }
  opponent: { playerId: string; playerName: string; coreHp: number }
  notices: string[]
}

export interface PvpOverviewData {
  profile: PvpProfile | null
  season: PvpSeason | null
  leaderboard: PvpLeaderboard | null
  history: PvpMatchSummary[]
  rooms: PvpRoomSummary[]
}
