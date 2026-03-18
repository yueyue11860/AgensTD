import type { TowerBehaviorDefinition, TowerBehaviorKind, TowerFireRate } from './tower-behavior'

export type PlayerKind = 'human' | 'agent'
export type ConnectionStatus = 'connected' | 'disconnected'
export type LogLevel = 'info' | 'warn' | 'error'
export type MatchStatus = 'waiting' | 'running' | 'finished'
export type MatchOutcome = 'victory' | 'defeat'
export type EnemyKind =
  | 'runner'
  | 'swift'
  | 'brute'
  | 'Grunt'
  | 'Speedster'
  | 'Tank'
  | 'Shielded'
  | 'Cleanser'
  | 'Lord-01'
  | 'Grunt-Armored'
  | 'Tank-Fortress'
  | 'Lord-02'
  | 'Swarm-Drone'
  | 'Swarm-Runner'
  | 'Cleanser-Pro'
  | 'Lord-03'
export type TowerTargetingStrategy = 'nearest' | 'first' | 'strongest'
export type StatusEffectKind = 'slow' | 'armor-break' | 'burn'
export type DamageType = 'physical' | 'magic' | 'true'

export interface Position {
  x: number
  y: number
}

export type GameMapCellKind = 'gate' | 'core' | 'path' | 'build' | 'blocked'

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
  /** 准备阶段(PREP)距下一波出怪的倒计时秒数，出怪中或清场时为 0 */
  prepCountdownSec: number
}

export interface MatchResultState {
  outcome: MatchOutcome
  decidedAtTick: number
  reason?: string
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

export interface EnemyCleanseTraitState {
  kind: 'cleanse'
  intervalMs: number
  remainingCooldownMs: number
}

export interface EnemySplitOnDeathTraitState {
  kind: 'split-on-death'
  spawnKind: EnemyKind
  spawnCount: number
}

export type EnemyTraitState = EnemyCleanseTraitState | EnemySplitOnDeathTraitState

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
  shield: number
  maxShield: number
  baseSpeed: number
  speed: number
  baseArmor: number
  armor: number
  // 兼容旧字段，值与 armor 保持一致。
  baseDefense: number
  // 兼容旧字段，值与 armor 保持一致。
  defense: number
  rewardGold: number
  baseDamage: number
  path: Position[]
  pathIndex: number
  lastDamagedByPlayerId: string | null
  activeEffects: EnemyStatusEffectState[]
  traits: EnemyTraitState[]
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
  status: MatchStatus
  result: MatchResultState | null
  playerCount: number
  maxCapacity: number
  overloadTicks: number
  /** 超载倒计时剩余秒数（0 = 未超载，>0 = 正在倒计时） */
  overloadCountdownSec: number
  map: GameMapState
  base: BaseState
  wave: WaveState
  players: PlayerState[]
  enemies: EnemyState[]
  towers: TowerState[]
  pendingActions: number
  logs: GameLogEntry[]
}