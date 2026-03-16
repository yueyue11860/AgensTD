import type { WaveConfig } from '../../../shared/contracts/game'
import type { PlayerKind } from '../domain/game-state'
import { defaultWaveConfigs } from './default-wave-configs'

export interface AuthTokenConfig {
  token: string
  playerId: string
  playerName: string
  playerKind: PlayerKind
}

export interface ServerConfig {
  port: number
  corsOrigin: string
  matchId: string
  tickRateMs: number
  mapWidth: number
  mapHeight: number
  playerStartingGold: number
  authRequired: boolean
  actionRateLimitWindowMs: number
  actionRateLimitMax: number
  replayMaxFrames: number
  replayMaxActions: number
  persistenceFlushEveryTicks: number
  supabaseUrl: string | null
  supabaseServiceRoleKey: string | null
  authTokens: AuthTokenConfig[]
  waveConfigs: WaveConfig[]
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

function readString(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function createDefaultMatchId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `agenstd-${stamp}`
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
    matchId: process.env.MATCH_ID ?? createDefaultMatchId(),
    tickRateMs: readNumber('TICK_RATE_MS', 100),
    mapWidth: readNumber('MAP_WIDTH', 30),
    mapHeight: readNumber('MAP_HEIGHT', 30),
    playerStartingGold: readNumber('PLAYER_STARTING_GOLD', 200),
    authRequired: readBoolean('AUTH_REQUIRED', true),
    actionRateLimitWindowMs: readNumber('ACTION_RATE_LIMIT_WINDOW_MS', 1000),
    actionRateLimitMax: readNumber('ACTION_RATE_LIMIT_MAX', 3),
    replayMaxFrames: readNumber('REPLAY_MAX_FRAMES', 300),
    replayMaxActions: readNumber('REPLAY_MAX_ACTIONS', 500),
    persistenceFlushEveryTicks: readNumber('PERSISTENCE_FLUSH_EVERY_TICKS', 10),
    supabaseUrl: readString('SUPABASE_URL'),
    supabaseServiceRoleKey: readString('SUPABASE_SERVICE_ROLE_KEY'),
    authTokens: buildAuthTokens(),
    waveConfigs: defaultWaveConfigs,
  }
}