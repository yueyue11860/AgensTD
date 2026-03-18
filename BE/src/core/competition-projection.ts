import type { ServerConfig } from '../config/server-config'
import type { DualLeaderboard, LeaderboardEntry, MatchResultRecord, ReplaySummary } from '../domain/competition'
import type { GameState } from '../domain/game-state'
import type { MatchReplay } from '../domain/replay'
import { projectFrontendGameState } from './state-projection'

export function getWaveIndexForTick(tick: number) {
  return Math.floor(tick / 10) + 1
}

export function buildMatchResults(state: GameState, config: ServerConfig): MatchResultRecord[] {
  const projected = projectFrontendGameState(state, config)
  const now = new Date().toISOString()

  return state.players.map((player) => ({
    matchId: state.matchId,
    playerId: player.id,
    playerName: player.name,
    playerKind: player.kind,
    survivedWaves: state.wave.index,
    score: player.score,
    fortress: projected.resources.fortress,
    updatedAt: now,
  }))
}

export function buildLiveLeaderboards(state: GameState): DualLeaderboard {
  const entries = state.players
    .map<LeaderboardEntry>((player) => ({
      playerId: player.id,
      playerName: player.name,
      playerKind: player.kind,
      bestSurvivedWaves: state.wave.index,
      bestScore: player.score,
      lastMatchId: state.matchId,
      updatedAt: new Date().toISOString(),
    }))
    .sort((left, right) => right.bestScore - left.bestScore || right.bestSurvivedWaves - left.bestSurvivedWaves)

  return {
    human: entries.filter((entry) => entry.playerKind === 'human'),
    agent: entries.filter((entry) => entry.playerKind === 'agent'),
    all: entries,
  }
}

export function buildReplaySummary(replay: MatchReplay): ReplaySummary {
  const latestFrame = replay.frames[replay.frames.length - 1]
  const topScore = replay.frames.reduce((winner, frame) => Math.max(winner, frame.gameState.score ?? 0), 0)
  const uniquePlayers = new Set(replay.actions.map((action) => action.player.playerId))

  return {
    matchId: replay.matchId,
    createdAt: replay.createdAt,
    updatedAt: replay.updatedAt,
    latestTick: latestFrame?.tick ?? 0,
    frameCount: replay.frames.length,
    actionCount: replay.actions.length,
    playerCount: uniquePlayers.size,
    topWave: latestFrame?.gameState.wave?.index ?? 0,
    topScore,
  }
}