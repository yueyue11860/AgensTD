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
}

export interface BattlefieldEnemyState extends BattlefieldGridPosition {
  entityId: string
  glyph: string
  hp: number
  maxHp: number
}

export interface BattlefieldSnapshot {
  tick: number
  pieces: BattlefieldPieceState[]
  enemies: BattlefieldEnemyState[]
}

export interface BattlefieldInteractionBridge {
  onCellClick: (x: number, y: number) => void
  onCellHover: (x: number, y: number) => void
  onCellLeave: () => void
}
