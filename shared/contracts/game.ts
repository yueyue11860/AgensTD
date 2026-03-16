export type PlayerKind = 'human' | 'agent'

export type CellKind = 'path' | 'build' | 'blocked' | 'relay' | 'gate' | 'core' | 'hazard'

export type TowerStatus = 'idle' | 'active' | 'cooldown' | 'disabled'

export type EnemyThreat = 'low' | 'medium' | 'high' | 'boss'

export type GameStatus = 'connecting' | 'waiting' | 'running' | 'paused' | 'finished'

export type GameOutcome = 'victory' | 'defeat'

export interface GridPosition {
  x: number
  y: number
}

export interface SpawnGroup {
  enemyType: string
  count: number
  interval: number
  delay: number
}

export interface WaveConfig {
  waveNumber: number
  prepTime: number
  groups: SpawnGroup[]
}

export interface PlayerIdentity {
  playerId: string
  playerName: string
  playerKind: PlayerKind
}

export interface GameCell extends GridPosition {
  kind: CellKind
  label?: string
  walkable?: boolean
  buildable?: boolean
}

export interface ResourceState {
  gold: number
  mana: number
  manaLimit?: number
  heat: number
  heatLimit?: number
  repair: number
  threat: number
  fortress: number
  fortressMax?: number
}

export interface BuildTowerAction extends GridPosition {
  action: 'BUILD_TOWER'
  type: string
}

export interface UpgradeTowerAction {
  action: 'UPGRADE_TOWER'
  towerId: string
}

export interface SellTowerAction {
  action: 'SELL_TOWER'
  towerId: string
}

export type GameAction = BuildTowerAction | UpgradeTowerAction | SellTowerAction

export interface ActionDescriptor {
  id: string
  label: string
  description?: string
  payload: GameAction
  disabled?: boolean
  reason?: string
}

export interface TowerBlueprint {
  type: string
  label: string
  description?: string
  costLabel?: string
  hotkey?: string
  disabled?: boolean
  reason?: string
}

export interface TowerFootprint {
  width: number
  height: number
}

export interface TowerState {
  id: string
  type: string
  name: string
  level: number
  status: TowerStatus
  cell: GridPosition
  footprint: TowerFootprint
  range?: number
  damage?: number
  attackRate?: number
  hp?: number
  maxHp?: number
  tags?: string[]
  commands?: ActionDescriptor[]
}

export interface EnemyState {
  id: string
  type: string
  name: string
  position: GridPosition
  hp: number
  maxHp: number
  threat: EnemyThreat
  count?: number
  intent?: string
  progress?: number
}

export interface GameState {
  matchId?: string
  tick: number
  status: GameStatus
  result: {
    outcome: GameOutcome
    decidedAtTick: number
    reason?: string
  } | null
  map: {
    width: number
    height: number
    cells: GameCell[]
  }
  resources: ResourceState
  towers: TowerState[]
  enemies: EnemyState[]
  buildPalette: TowerBlueprint[]
  actionBar?: {
    title?: string
    summary?: string
    actions: ActionDescriptor[]
  }
  wave?: {
    index: number
    label?: string
  }
  notices?: string[]
  score?: number
  updatedAt?: string
}

export interface TickEnvelope {
  gameState: GameState
}