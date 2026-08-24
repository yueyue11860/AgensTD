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
  boardRevision: number
  tray: Array<PvePiece | null>
  boardPieces: PveBoardPiece[]
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
    | 'BOARD_PIECE_MOVED'
    | 'SOLDIER_MERGED'
    | 'WAVE_STARTED'
    | 'ENEMY_SPAWNED'
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
}

export type PveRuntimeAction =
  | RecruitBatchAction
  | SwapTrayBoardAction
  | MoveBoardPieceAction
  | MergeSoldiersAction

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
  eventHistoryLimit?: number
}
