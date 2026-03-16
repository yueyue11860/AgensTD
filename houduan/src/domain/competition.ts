import type { PlayerKind } from './game-state'

export type {
  DualLeaderboard,
  LeaderboardEntry,
  ReplaySummary,
} from '../../../shared/contracts/competition'

export interface MatchResultRecord {
  matchId: string
  playerId: string
  playerName: string
  playerKind: PlayerKind
  survivedWaves: number
  score: number
  fortress: number
  updatedAt: string
}
