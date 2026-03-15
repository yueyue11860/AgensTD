import type { PlayerKind } from './game-state'

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

export interface LeaderboardEntry {
  playerId: string
  playerName: string
  playerKind: PlayerKind
  bestSurvivedWaves: number
  bestScore: number
  lastMatchId: string
  updatedAt: string
}

export interface ReplaySummary {
  matchId: string
  createdAt: string
  updatedAt: string
  latestTick: number
  frameCount: number
  actionCount: number
  playerCount: number
  topWave: number
  topScore: number
}

export interface DualLeaderboard {
  human: LeaderboardEntry[]
  agent: LeaderboardEntry[]
  all: LeaderboardEntry[]
}