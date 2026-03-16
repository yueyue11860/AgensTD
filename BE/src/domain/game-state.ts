export type PlayerKind = 'human' | 'agent'
export type ConnectionStatus = 'connected' | 'disconnected'
export type LogLevel = 'info' | 'warn' | 'error'
export type EnemyKind = 'runner' | 'swift' | 'brute'
export type TowerTargetingStrategy = 'nearest' | 'first' | 'strongest'

export interface Position {
  x: number
  y: number
}

export type GameMapCellKind = 'gate' | 'core' | 'build' | 'blocked'

export interface GameMapCellState extends Position {
  kind: GameMapCellKind
  walkable: boolean
  buildable: boolean
  label?: string
}

export interface BaseState extends Position {
  hp: number
  maxHp: number
}

export interface WaveState {
  index: number
  label: string
  startedAtTick: number
  endsAtTick: number | null
  remainingSpawns: number
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
  kind: EnemyKind
  hp: number
  maxHp: number
  speed: number
  rewardGold: number
  baseDamage: number
  path: Position[]
  pathIndex: number
  lastDamagedByPlayerId: string | null
}

export interface TowerState extends Position {
  id: string
  ownerId: string
  type: string
  damage: number
  range: number
  fireRateTicks: number
  cooldownTicks: number
  targetingStrategy: TowerTargetingStrategy
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
  cells: GameMapCellState[]
  spawn: Position
  base: Position
}

export interface GameState {
  matchId: string
  tick: number
  tickRateMs: number
  startedAt: number
  map: GameMapState
  base: BaseState
  wave: WaveState
  players: PlayerState[]
  enemies: EnemyState[]
  towers: TowerState[]
  pendingActions: number
  logs: GameLogEntry[]
}