import type { CombatTargetGeometry } from '../../../shared/contracts/game'

export interface BattlefieldGridPosition {
  x: number
  y: number
}

export interface BattlefieldPieceState extends BattlefieldGridPosition {
  entityId: string
  ownerPlayerId: string
  kind: 'soldier' | 'character'
  glyph: string
  soldierType?: string
  level?: number
  formationId?: string
  generalId?: string
  generalName?: string
  generalQuality?: 'purple' | 'orange' | 'red'
  generalArchetype?: 'physical' | 'magic' | 'summon' | 'control'
  generalFixed?: boolean
}

export interface BattlefieldEnemyState extends BattlefieldGridPosition {
  entityId: string
  entityKind: 'ordinary_minion' | 'boss'
  bossDefinitionId: string | null
  bossName: string | null
  controlResistanceBps: number
  bossPhase: number
  activeCast: {
    skillId: string
    skillName: string
    startedAtTick: number
    executeAtTick: number
    targetPlayerIds: string[]
    actionId?: string
    targetIds?: string[]
    geometry?: CombatTargetGeometry | null
  } | null
  glyph: string
  hp: number
  maxHp: number
  /** Optional until the server projects a first-class ordinary enemy archetype. */
  enemyRole?: string | null
  armor?: number
  magicResistance?: number
  moveSpeedMilliCellsPerSecond?: number
  waveNumber?: number
  spawnProtected?: boolean
  invulnerable?: boolean
}

export interface BattlefieldEnemyStatusState {
  instanceId: string
  enemyId: string
  statusId: string
  magnitude: number
  stacks: number
  expiresAtTick: number
}

export interface BattlefieldSummonedUnitState extends BattlefieldGridPosition {
  entityId: string
  ownerPlayerId: string
  sourceGeneralId: string
  summonUnitId: string
  glyph: string
  ownerLevel: number
  expiresAtTick: number
}

export interface BattlefieldEffectZoneState extends BattlefieldGridPosition {
  entityId: string
  ownerPlayerId: string
  sourceGeneralId: string
  zoneId: string
  shape:
    | { kind: 'circle', radiusMilliCells: number }
    | { kind: 'line', lengthMilliCells: number, halfWidthMilliCells: number }
  expiresAtTick: number
}

/**
 * 服务端 PVE recentEvents 的战场只读投影。表现层只消费这些原始字段，
 * 不反写权威战斗状态；未知事件会被安全忽略。
 */
export interface BattlefieldCombatEventState {
  id: string
  tick: number
  type: string
  data: Record<string, string | number | boolean | string[] | number[] | null>
  actionId?: string
  targetIds?: string[]
  geometry?: CombatTargetGeometry | null
}

export interface BattlefieldSnapshot {
  tick: number
  /** 可选是为了兼容旧调用方；接入后用于精确的过时事件追帧。 */
  tickRateMs?: number
  pieces: BattlefieldPieceState[]
  enemies: BattlefieldEnemyState[]
  statuses: BattlefieldEnemyStatusState[]
  summonedUnits: BattlefieldSummonedUnitState[]
  zones: BattlefieldEffectZoneState[]
  /** PVE recentEvents 原样传入；事件 id 是表现幂等键。 */
  recentEvents?: BattlefieldCombatEventState[]
}

export interface BattlefieldInteractionBridge {
  onCellClick: (x: number, y: number) => void
  onCellHover: (x: number, y: number) => void
  onCellLeave: () => void
}
