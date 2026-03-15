import type { PlayerKind } from '../domain/game-state'

export interface AuthTokenConfig {
  token: string
  playerId: string
  playerName: string
  playerKind: PlayerKind
}

export interface ServerConfig {
  port: number
  corsOrigin: string
  tickRateMs: number
  mapWidth: number
  mapHeight: number
  playerStartingGold: number
  authRequired: boolean
  actionRateLimitWindowMs: number
  actionRateLimitMax: number
  authTokens: AuthTokenConfig[]
}

function readNumber(name: string, fallback: number) {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readBoolean(name: string, fallback: boolean) {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  return value === '1' || value.toLowerCase() === 'true'
}

function buildAuthTokens(): AuthTokenConfig[] {
  return [
    {
      token: process.env.HUMAN_GATEWAY_TOKEN ?? 'human-dev-token',
      playerId: process.env.HUMAN_PLAYER_ID ?? 'human-dev',
      playerName: process.env.HUMAN_PLAYER_NAME ?? 'Human Player',
      playerKind: 'human',
    },
    {
      token: process.env.AGENT_GATEWAY_TOKEN ?? 'agent-dev-token',
      playerId: process.env.AGENT_PLAYER_ID ?? 'agent-dev',
      playerName: process.env.AGENT_PLAYER_NAME ?? 'Agent Player',
      playerKind: 'agent',
    },
  ]
}

export function createServerConfig(): ServerConfig {
  return {
    port: readNumber('PORT', 3000),
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    tickRateMs: readNumber('TICK_RATE_MS', 100),
    mapWidth: readNumber('MAP_WIDTH', 12),
    mapHeight: readNumber('MAP_HEIGHT', 8),
    playerStartingGold: readNumber('PLAYER_STARTING_GOLD', 200),
    authRequired: readBoolean('AUTH_REQUIRED', true),
    actionRateLimitWindowMs: readNumber('ACTION_RATE_LIMIT_WINDOW_MS', 1000),
    actionRateLimitMax: readNumber('ACTION_RATE_LIMIT_MAX', 3),
    authTokens: buildAuthTokens(),
  }
}