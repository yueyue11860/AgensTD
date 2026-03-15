export type CellKind = 'path' | 'build' | 'blocked' | 'relay' | 'gate' | 'core' | 'hazard'

export interface GridPosition {
  x: number
  y: number
}

export interface FrontendGameCell extends GridPosition {
  kind: CellKind
  label?: string
  walkable?: boolean
  buildable?: boolean
}

export interface FrontendResourceState {
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

export interface FrontendActionDescriptor {
  id: string
  label: string
  description?: string
  payload: {
    action: string
    [key: string]: unknown
  }
  disabled?: boolean
  reason?: string
}

export interface FrontendTowerBlueprint {
  type: string
  label: string
  description?: string
  costLabel?: string
  hotkey?: string
  disabled?: boolean
  reason?: string
}

export interface FrontendTowerState {
  id: string
  type: string
  name: string
  level: number
  status: 'idle' | 'active' | 'cooldown' | 'disabled'
  cell: GridPosition
  footprint: {
    width: number
    height: number
  }
  range?: number
  damage?: number
  attackRate?: number
  hp?: number
  maxHp?: number
  tags?: string[]
  commands?: FrontendActionDescriptor[]
}

export interface FrontendEnemyState {
  id: string
  type: string
  name: string
  position: GridPosition
  hp: number
  maxHp: number
  threat: 'low' | 'medium' | 'high' | 'boss'
  count?: number
  intent?: string
  progress?: number
}

export interface FrontendGameState {
  matchId?: string
  tick: number
  status: 'connecting' | 'waiting' | 'running' | 'paused' | 'finished'
  map: {
    width: number
    height: number
    cells: FrontendGameCell[]
  }
  resources: FrontendResourceState
  towers: FrontendTowerState[]
  enemies: FrontendEnemyState[]
  buildPalette: FrontendTowerBlueprint[]
  actionBar?: {
    title?: string
    summary?: string
    actions: FrontendActionDescriptor[]
  }
  wave?: {
    index: number
    label?: string
  }
  notices?: string[]
  score?: number
  updatedAt?: string
}
