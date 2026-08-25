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
  expectedTrayRevision?: number
  expectedBoardRevision?: number
  expectedReserveRevision?: number
}

export interface SwapReserveBoardAction extends GridPosition {
  action: 'SWAP_RESERVE_BOARD'
  reserveIndex: number
  expectedReserveRevision?: number
  expectedBoardRevision?: number
}

export interface ExileReserveAction {
  action: 'EXILE_RESERVE'
  expectedReserveRevision?: number
}

export type PveStorageZone = 'tray' | 'reserve'

export interface SwapStoragePiecesAction {
  action: 'SWAP_STORAGE_PIECES'
  sourceZone: PveStorageZone
  sourceIndex: number
  targetZone: PveStorageZone
  targetIndex: number
  expectedTrayRevision?: number
  expectedReserveRevision?: number
}

export interface SetGeneralFixedAction {
  action: 'SET_GENERAL_FIXED'
  formationId: string
  fixed: boolean
  expectedBoardRevision?: number
}

export interface MoveFixedGeneralAction extends GridPosition {
  action: 'MOVE_FIXED_GENERAL'
  formationId: string
  expectedBoardRevision?: number
}

export type ActiveItemTargetPayload =
  | { kind: 'none' }
  | { kind: 'piece'; pieceId: string; expectedRevision: number }
  | { kind: 'general'; generalId: string }
  | { kind: 'enemy'; enemyId: string }
  | { kind: 'battlefield_point'; xMilli: number; yMilli: number }
  | {
      kind: 'discarded_character_to_empty_slot'
      tokenId: string
      expectedTokenRevision: number
      destination: { zone: 'summon_tray' | 'reserve'; index: number; expectedRevision: number }
    }

export interface UseActiveItemAction {
  action: 'USE_ACTIVE_ITEM'
  slotIndex: 0 | 1
  itemId: string
  target: ActiveItemTargetPayload
  expectedItemRuntimeVersion: number
}

export type PveGameAction =
  | RecruitBatchAction
  | DeployTrayPieceAction
  | MoveBoardPieceAction
  | MergeSoldiersAction
  | SwapReserveBoardAction
  | ExileReserveAction
  | SwapStoragePiecesAction
  | SetGeneralFixedAction
  | MoveFixedGeneralAction
  | UseActiveItemAction

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

export interface PveReserveSlotState {
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
  formationId?: string
  generalId?: string
  generalName?: string
  generalQuality?: 'purple' | 'orange' | 'red'
  generalArchetype?: 'physical' | 'magic' | 'summon' | 'control'
  generalFixed?: boolean
}

export interface PveGeneralFormationState {
  formationId: string
  generalId: string
  name: string
  characterEntityIds: string[]
  cells: GridPosition[]
  anchor: GridPosition
  fixed: boolean
}

export interface PveGeneralProgressState {
  generalId: string
  name: string
  quality: 'purple' | 'orange' | 'red'
  archetype: 'physical' | 'magic' | 'summon' | 'control'
  level: 1 | 2 | 3 | 4 | 5
  maxLevel: 1 | 2 | 3 | 4 | 5
  experiencePoints: number
  experienceToNextLevel: number | null
  nextBasicAttackTick: number
  activeSkillReadyAtTick: number
  basicAttackCount: number
  nextPassiveTriggerTick: number
  activeSkillName: string
  attack: number
  attackIntervalMs: number
  attackRangeMilliCells: number
  critChanceBps: number
  critDamageBps: number
  activeSkillCooldownMs: number
  activeStatuses: PveGeneralStatusState[]
}

export interface PveGeneralStatusState {
  instanceId: string
  ownerPlayerId: string
  sourceGeneralId: string
  sourceFormationId: string
  statusId: string
  stackGroup: string
  magnitude: number
  stacks: number
  appliedAtTick: number
  expiresAtTick: number
}

export interface PveActiveSynergyState {
  synergyId: string
  name: string
  level: number
  contributingGeneralIds: string[]
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
  spawnProtected: boolean
  invulnerable: boolean
}

export interface PveEnemyStatusState {
  instanceId: string
  enemyId: string
  sourceGeneralId: string
  ownerPlayerId: string
  statusId: string
  stackGroup: string
  magnitude: number
  stacks: number
  appliedAtTick: number
  expiresAtTick: number
}

export interface PveSummonedUnitState extends GridPosition {
  entityId: string
  ownerPlayerId: string
  sourceGeneralId: string
  sourceFormationId: string
  summonUnitId: string
  glyph: string
  ownerLevel: 1 | 2 | 3 | 4 | 5
  nextAttackTick: number
  expiresAtTick: number
}

export interface PveEffectZoneState extends GridPosition {
  entityId: string
  ownerPlayerId: string
  sourceGeneralId: string
  sourceFormationId: string
  effectId: string
  zoneId: string
  shape:
    | { kind: 'circle', radiusMilliCells: number }
    | { kind: 'line', lengthMilliCells: number, halfWidthMilliCells: number }
  nextTick: number
  expiresAtTick: number
}

export interface PveCombatEventState {
  id: string
  tick: number
  type: string
  data: Record<string, string | number | boolean | string[] | number[] | null>
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
  reserveRevision: number
  boardRevision: number
  tray: PveTraySlotState[]
  reserve: PveReserveSlotState[]
  discardedCharacters: Array<{ entityId: string; glyph: string; createdSequence: number }>
  itemRuntime: {
    version: number
    slots: Array<{
      itemId: string
      slotIndex: 0 | 1
      chargesRemaining: number
      cooldownEndsAtTick: number
      usesThisMatch: number
      enabled: boolean
    } | null>
  } | null
  weaponLoadoutByGeneralId: Record<string, readonly [string | null, string | null]>
  generalFormations: PveGeneralFormationState[]
  generalProgress: PveGeneralProgressState[]
  activeSynergies: PveActiveSynergyState[]
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
  statuses: PveEnemyStatusState[]
  summonedUnits: PveSummonedUnitState[]
  zones: PveEffectZoneState[]
  recentEvents: PveCombatEventState[]
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
