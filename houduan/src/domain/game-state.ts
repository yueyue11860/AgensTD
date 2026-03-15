export type PlayerKind = 'human' | 'agent'
export type ConnectionStatus = 'connected' | 'disconnected'
export type LogLevel = 'info' | 'warn' | 'error'

export interface Position {
  x: number
  y: number
}

export interface PlayerState {
  id: string
  name: string
  kind: PlayerKind
  gold: number
  score: number
  connectionStatus: ConnectionStatus
  lastActionAt: number | null
}

export interface EnemyState extends Position {
  id: string
  kind: 'runner'
  hp: number
  maxHp: number
  speed: number
  rewardGold: number
}

export interface TowerState extends Position {
  id: string
  ownerId: string
  type: string
  damage: number
  range: number
  fireRateTicks: number
  cooldownTicks: number
}

export interface GameLogEntry {
  tick: number
  level: LogLevel
  message: string
  meta?: Record<string, unknown>
}

export interface GameMapState {
  width: number
  height: number
}

export interface GameState {
  matchId: string
  tick: number
  tickRateMs: number
  startedAt: number
  map: GameMapState
  players: PlayerState[]
  enemies: EnemyState[]
  towers: TowerState[]
  pendingActions: number
  logs: GameLogEntry[]
}