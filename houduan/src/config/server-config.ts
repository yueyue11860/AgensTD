export interface ServerConfig {
  port: number
  corsOrigin: string
  tickRateMs: number
  mapWidth: number
  mapHeight: number
  playerStartingGold: number
}

function readNumber(name: string, fallback: number) {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function createServerConfig(): ServerConfig {
  return {
    port: readNumber('PORT', 3000),
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    tickRateMs: readNumber('TICK_RATE_MS', 100),
    mapWidth: readNumber('MAP_WIDTH', 12),
    mapHeight: readNumber('MAP_HEIGHT', 8),
    playerStartingGold: readNumber('PLAYER_STARTING_GOLD', 200),
  }
}