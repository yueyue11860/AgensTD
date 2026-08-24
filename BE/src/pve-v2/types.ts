export type PveLaneSlot = 'P1' | 'P2' | 'P3' | 'P4'

export type SoldierType = 'blade' | 'spear' | 'bow' | 'cavalry'

export type SoldierLevel = 1 | 2 | 3 | 4 | 5

export type PveRuntimeStatus = 'waiting' | 'running' | 'finished'

export type PveWavePhase = 'idle' | 'prep' | 'spawning' | 'clearing' | 'complete'

export interface PvePosition {
  x: number
  y: number
}

export interface PveLaneRoute {
  waypoints: PvePosition[]
  loopStartIndex: number
}

export interface SoldierPiece {
  id: string
  kind: 'soldier'
  ownerPlayerId: string
  soldierType: SoldierType
  level: SoldierLevel
  nextAttackTick: number
  createdSequence: number
}

export interface CharacterPiece {
  id: string
  kind: 'character'
  ownerPlayerId: string
  glyph: string
  createdSequence: number
}

export type PvePiece = SoldierPiece | CharacterPiece

export interface PveBoardPiece extends PvePosition {
  piece: PvePiece
}

export interface PveGeneralFormationSnapshot {
  formationId: string
  generalId: string
  name: string
  characterPieceIds: string[]
  cells: PvePosition[]
  anchorXMilli: number
  anchorYMilli: number
  fixed: boolean
}

export interface PveGeneralProgressSnapshot {
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
  activeSkillName: string
  attack: number
  attackIntervalMs: number
  attackRangeMilliCells: number
  critChanceBps: number
  critDamageBps: number
  activeSkillCooldownMs: number
}

export interface PveActiveSynergySnapshot {
  synergyId: string
  name: string
  level: number
  contributingGeneralIds: string[]
}

export interface PveEnemySnapshot {
  id: string
  glyph: string
  waveNumber: number
  laneOwnerPlayerId: string
  laneSlot: PveLaneSlot
  spawnSequence: number
  xMilli: number
  yMilli: number
  routeWaypointIndex: number
  lapCount: number
  pathProgressMilli: number
  currentHp: number
  maxHp: number
  armor: number
  magicResistance: number
  moveSpeedMilliCellsPerSecond: number
  lastDamagePlayerId: string | null
  /** 圆形身体尚未完全离开中央 3×3 出生方格；只会从 true 变为 false。 */
  spawnProtected: boolean
  /** 预留给未来 Boss/技能的战斗无敌，与空间入场锁分离。 */
  invulnerable: boolean
}

export interface PvePlayerSnapshot {
  playerId: string
  slot: PveLaneSlot
  rice: number
  recruitCount: number
  nextRecruitCost: number
  populationUsed: number
  populationCap: number
  trayRevision: number
  reserveRevision: number
  boardRevision: number
  tray: Array<PvePiece | null>
  reserve: Array<PvePiece | null>
  boardPieces: PveBoardPiece[]
  generalFormations: PveGeneralFormationSnapshot[]
  generalProgress: PveGeneralProgressSnapshot[]
  activeSynergies: PveActiveSynergySnapshot[]
  remainingCharacterTokens: Record<string, number>
  clearedWaves: number[]
}

export interface PveRuntimeEvent {
  id: string
  tick: number
  type:
    | 'MATCH_STARTED'
    | 'RECRUITED'
    | 'TRAY_BOARD_SWAPPED'
    | 'RESERVE_BOARD_SWAPPED'
    | 'RESERVE_EXILED'
    | 'STORAGE_PIECES_SWAPPED'
    | 'BOARD_PIECE_MOVED'
    | 'SOLDIER_MERGED'
    | 'GENERAL_ACTIVATED'
    | 'GENERAL_DEACTIVATED'
    | 'GENERAL_FIXED_CHANGED'
    | 'FIXED_GENERAL_MOVED'
    | 'GENERAL_BASIC_ATTACK_STARTED'
    | 'GENERAL_SKILL_CAST'
    | 'GENERAL_XP_GRANTED'
    | 'GENERAL_LEVEL_UP'
    | 'SYNERGY_ACTIVATED'
    | 'SYNERGY_DEACTIVATED'
    | 'WAVE_STARTED'
    | 'ENEMY_SPAWNED'
    | 'ENEMY_ENTERED_BATTLEFIELD'
    | 'BASIC_ATTACK_STARTED'
    | 'DAMAGE_APPLIED'
    | 'ENEMY_DIED'
    | 'RICE_GRANTED'
    | 'GENERAL_XP_SETTLEMENT_AVAILABLE'
    | 'LANE_WAVE_CLEARED'
    | 'MATCH_FINISHED'
  data: Record<string, string | number | boolean | string[] | number[] | null>
}

export interface PveRuntimeSnapshot {
  schemaVersion: 2
  tick: number
  tickRateMs: number
  seed: string
  rngState: number
  status: PveRuntimeStatus
  result: {
    outcome: 'victory' | 'defeat'
    reason: string
    decidedAtTick: number
  } | null
  playerCountAtStart: number
  enemyCapacity: number
  overloadTicks: number
  overloadCountdownMs: number
  wave: {
    number: number
    maxWaves: number
    phase: PveWavePhase
    prepRemainingTicks: number
    lanes: Array<{
      playerId: string
      slot: PveLaneSlot
      spawnedCount: number
      totalCount: number
      cleared: boolean
      clearRewardGranted: boolean
      retired: boolean
    }>
  }
  players: PvePlayerSnapshot[]
  enemies: PveEnemySnapshot[]
  recentEvents: PveRuntimeEvent[]
}

export interface RecruitBatchAction {
  type: 'RECRUIT_BATCH'
  actionId: string
  expectedTrayRevision?: number
}

export interface SwapTrayBoardAction {
  type: 'SWAP_TRAY_BOARD'
  actionId: string
  trayIndex: number
  boardX: number
  boardY: number
  expectedTrayRevision?: number
  expectedBoardRevision?: number
}

export interface MoveBoardPieceAction {
  type: 'MOVE_BOARD_PIECE'
  actionId: string
  pieceId: string
  targetX: number
  targetY: number
  expectedBoardRevision?: number
}

export interface MergeSoldiersAction {
  type: 'MERGE_SOLDIERS'
  actionId: string
  sourcePieceId: string
  targetPieceId: string
  expectedTrayRevision?: number
  expectedBoardRevision?: number
  expectedReserveRevision?: number
}

export interface SwapReserveBoardAction {
  type: 'SWAP_RESERVE_BOARD'
  actionId: string
  reserveIndex: number
  boardX: number
  boardY: number
  expectedReserveRevision?: number
  expectedBoardRevision?: number
}

export interface ExileReserveAction {
  type: 'EXILE_RESERVE'
  actionId: string
  expectedReserveRevision?: number
}

export interface SwapStoragePiecesAction {
  type: 'SWAP_STORAGE_PIECES'
  actionId: string
  sourceZone: 'tray' | 'reserve'
  sourceIndex: number
  targetZone: 'tray' | 'reserve'
  targetIndex: number
  expectedTrayRevision?: number
  expectedReserveRevision?: number
}

export interface SetGeneralFixedAction {
  type: 'SET_GENERAL_FIXED'
  actionId: string
  formationId: string
  fixed: boolean
  expectedBoardRevision?: number
}

export interface MoveFixedGeneralAction {
  type: 'MOVE_FIXED_GENERAL'
  actionId: string
  formationId: string
  targetStartX: number
  targetStartY: number
  expectedBoardRevision?: number
}

export type PveRuntimeAction =
  | RecruitBatchAction
  | SwapTrayBoardAction
  | MoveBoardPieceAction
  | MergeSoldiersAction
  | SwapReserveBoardAction
  | ExileReserveAction
  | SwapStoragePiecesAction
  | SetGeneralFixedAction
  | MoveFixedGeneralAction

export interface PveRuntimeResult {
  ok: boolean
  code: string
  tick: number
  actionId?: string
  details?: Record<string, string | number | boolean | null>
}

export interface PveGameRuntimeOptions {
  seed: string | number
  tickRateMs?: number
  prepDurationMs?: number
  maxWaves?: number
  laneRoutes?: Partial<Record<PveLaneSlot, PveLaneRoute>>
  isDeployableCell?: (slot: PveLaneSlot, x: number, y: number) => boolean
  characterTokens?: Record<string, number>
  /** 可选的关卡每波字池；数量由波次数值表统一控制。 */
  waveGlyphPools?: readonly (readonly string[])[]
  eventHistoryLimit?: number
}
