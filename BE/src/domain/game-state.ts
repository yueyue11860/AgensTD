import type { TowerBehaviorDefinition, TowerBehaviorKind, TowerFireRate } from './tower-behavior'

export type PlayerKind = 'human' | 'agent'
export type ConnectionStatus = 'connected' | 'disconnected'
export type LogLevel = 'info' | 'warn' | 'error'
export type EnemyKind = 'runner' | 'swift' | 'brute'
export type TowerTargetingStrategy = 'nearest' | 'first' | 'strongest'
export type StatusEffectKind = 'slow' | 'armor-break' | 'burn'

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

export interface EnemyStatusEffectTemplate {
  kind: StatusEffectKind
  remainingDurationMs: number | null
  speedMultiplier?: number
  defenseModifier?: number
  damagePerSecond?: number
  maxHpDamagePerSecondRatio?: number
  ignoresDefense?: boolean
}

export interface EnemyStatusEffectState extends EnemyStatusEffectTemplate {
  id: string
  sourcePlayerId: string | null
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
  baseSpeed: number
  speed: number
  baseDefense: number
  defense: number
  rewardGold: number
  baseDamage: number
  path: Position[]
  pathIndex: number
  lastDamagedByPlayerId: string | null
  activeEffects: EnemyStatusEffectState[]
}

export interface TowerState extends Position {
  id: string
  ownerId: string
  type: string
  width: number
  height: number
  behaviorKind: TowerBehaviorKind
  behavior: TowerBehaviorDefinition
  attackEffects: EnemyStatusEffectTemplate[]
  damage: number
  range: number
  fireRateTicks: TowerFireRate
  cooldownTicks: number
  targetingStrategy: TowerTargetingStrategy
  currentTargetId: string | null
  lockTimeMs: number
  incomeProgressMs: number
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