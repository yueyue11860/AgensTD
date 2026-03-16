import type { GameAction, GameState, PlayerIdentity } from './game'

export interface LeaderboardEntry {
  playerId: string
  playerName: string
  playerKind: PlayerIdentity['playerKind']
  bestSurvivedWaves: number
  bestScore: number
  lastMatchId: string
  updatedAt: string
}

export interface DualLeaderboard {
  human: LeaderboardEntry[]
  agent: LeaderboardEntry[]
  all: LeaderboardEntry[]
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

export interface ReplayActionRecord {
  id: string
  receivedAt: number
  player: PlayerIdentity
  action: GameAction
}

export interface ReplayFrame {
  tick: number
  recordedAt: string
  gameState: GameState
}

export interface MatchReplay {
  matchId: string
  createdAt: string
  updatedAt: string
  actions: ReplayActionRecord[]
  frames: ReplayFrame[]
}

export interface MatchReplayEnvelope {
  replay: MatchReplay
}