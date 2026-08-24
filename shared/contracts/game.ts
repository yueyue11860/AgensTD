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

export type PvePlayerSlotId = 'P1' | 'P2' | 'P3' | 'P4'

export type SoldierType = 'blade' | 'spear' | 'bow' | 'cavalry'

export type PvePieceKind = 'soldier' | 'character'

export interface RecruitBatchAction {
  action: 'RECRUIT_BATCH'
  expectedTrayRevision?: number
}

export interface DeployTrayPieceAction extends GridPosition {
  action: 'DEPLOY_TRAY_PIECE'
  trayIndex: number
  expectedTrayRevision?: number
  expectedBoardRevision?: number
}

export interface MoveBoardPieceAction extends GridPosition {
  action: 'MOVE_BOARD_PIECE'
  entityId: string
  expectedBoardRevision?: number
}

export interface MergeSoldiersAction {
  action: 'MERGE_SOLDIERS'
  sourceEntityId: string
  targetEntityId: string
  expectedBoardRevision?: number
}

export type PveGameAction =
  | RecruitBatchAction
  | DeployTrayPieceAction
  | MoveBoardPieceAction
  | MergeSoldiersAction

export type GameAction =
  | BuildTowerAction
  | UpgradeTowerAction
  | SellTowerAction
  | PveGameAction

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

export interface PveTrayPieceState {
  entityId: string
  kind: PvePieceKind
  glyph: string
  soldierType?: SoldierType
  level?: 1 | 2 | 3 | 4 | 5
}

export interface PveTraySlotState {
  index: number
  piece: PveTrayPieceState | null
}

export interface PveBoardPieceState extends GridPosition {
  entityId: string
  ownerPlayerId: string
  kind: PvePieceKind
  glyph: string
  soldierType?: SoldierType
  level?: 1 | 2 | 3 | 4 | 5
  nextAttackTick?: number
}

export interface PveEnemyState extends GridPosition {
  entityId: string
  glyph: string
  waveNumber: number
  homeLanePlayerId: string
  homeSlotId: PvePlayerSlotId
  routeZone: 'private_lane' | 'public_loop'
  hp: number
  maxHp: number
  armor: number
  magicResistance: number
  moveSpeedMilliCellsPerSecond: number
  pathIndex: number
  pathProgressMilli: number
  lapCount: number
}

export interface PvePlayerState {
  playerId: string
  slotId: PvePlayerSlotId
  rice: number
  recruitSequence: number
  nextRecruitCost: number
  populationUsed: number
  populationCap: number
  trayRevision: number
  boardRevision: number
  tray: PveTraySlotState[]
  highestCompletedWave: number
}

export interface PveLaneWaveState {
  playerId: string
  slotId: PvePlayerSlotId
  waveNumber: number
  plannedSpawnCount: number
  spawnedCount: number
  aliveEnemyCount: number
  spawningCompleted: boolean
  clearRewardRice: number
  clearRewardGranted: boolean
}

export interface PveMatchState {
  schemaVersion: 2
  phase: 'waiting' | 'running' | 'finished'
  tick: number
  players: PvePlayerState[]
  boardPieces: PveBoardPieceState[]
  enemies: PveEnemyState[]
  laneWaves: PveLaneWaveState[]
  currentWave: number
  maxWaves: number
  enemyCount: number
  maxCapacity: number
  overloadCountdownSec: number
}

export interface EntityDelta<T extends { id: string }> {
  upsert: T[]
  remove: string[]
}

export interface GameUiState {
  buildPalette: GameState['buildPalette']
  actionBar: GameState['actionBar']
}

export interface GameUiStateUpdate {
  buildPalette?: GameState['buildPalette']
  actionBar?: GameState['actionBar']
}

export interface GameNoticeUpdate {
  notices: GameState['notices']
}

export interface RoomRuntimeState {
  playerCount: number
  enemyCount: number
  maxCapacity: number
  overloadTicks: number
  overloadCountdownSec: number
  /** 房间共享经济的兼容口径：当前房间内所有玩家金币总和。 */
  totalGold: number
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
  room?: RoomRuntimeState
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
  pve?: PveMatchState
}

export interface GameStatePatch {
  tick: GameState['tick']
  status: GameState['status']
  result: GameState['result']
  resources: GameState['resources']
  room?: GameState['room']
  towers?: GameState['towers']
  enemies?: GameState['enemies']
  towerDelta?: EntityDelta<TowerState>
  enemyDelta?: EntityDelta<EnemyState>
  wave?: GameState['wave']
  score?: GameState['score']
  updatedAt?: GameState['updatedAt']
  map?: GameState['map']
  pve?: GameState['pve']
}

export interface FullTickEnvelope {
  mode: 'full'
  gameState: GameState
  sentAt: number
}

export interface PatchTickEnvelope {
  mode: 'patch'
  patch: GameStatePatch
  sentAt: number
}

export interface CheckpointTickEnvelope {
  /** 周期权威校准：包含全部动态实体，但不重复发送静态地图和 UI 描述。 */
  mode: 'checkpoint'
  patch: GameStatePatch
  sentAt: number
}

export type TickEnvelope = FullTickEnvelope | PatchTickEnvelope | CheckpointTickEnvelope

export interface ActionCommand {
  requestId: string
  clientTick?: number
  payload: GameAction
}
