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
  glyph: string
  hp: number
  maxHp: number
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

export interface BattlefieldSnapshot {
  tick: number
  pieces: BattlefieldPieceState[]
  enemies: BattlefieldEnemyState[]
  statuses: BattlefieldEnemyStatusState[]
  summonedUnits: BattlefieldSummonedUnitState[]
  zones: BattlefieldEffectZoneState[]
}

export interface BattlefieldInteractionBridge {
  onCellClick: (x: number, y: number) => void
  onCellHover: (x: number, y: number) => void
  onCellLeave: () => void
}
