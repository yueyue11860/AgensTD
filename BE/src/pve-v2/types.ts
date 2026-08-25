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
  basicAttackCount: number
  nextPassiveTriggerTick: number
  activeSkillName: string
  attack: number
  attackIntervalMs: number
  attackRangeMilliCells: number
  critChanceBps: number
  critDamageBps: number
  activeSkillCooldownMs: number
  /** 神将自身的可解释持续状态；敌方状态仍位于顶层 statuses。 */
  activeStatuses: PveGeneralStatusSnapshot[]
}

export interface PveGeneralStatusSnapshot {
  instanceId: string
  ownerPlayerId: string
  sourceGeneralId: string
  sourceFormationId: string
  statusId: 'next_basic_attack_damage_up' | 'attack_speed_up' | string
  stackGroup: string
  magnitude: number
  stacks: number
  appliedAtTick: number
  expiresAtTick: number
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

export interface PveEnemyStatusSnapshot {
  instanceId: string
  enemyId: string
  sourceGeneralId: string
  ownerPlayerId: string
  statusId: 'slow' | 'stun' | 'root' | 'suppress' | 'vulnerable' | 'armor_break' | string
  stackGroup: string
  magnitude: number
  stacks: number
  appliedAtTick: number
  expiresAtTick: number
}

export interface PveSummonedUnitSnapshot {
  id: string
  ownerPlayerId: string
  sourceGeneralId: string
  sourceFormationId: string
  summonUnitId: string
  glyph: string
  xMilli: number
  yMilli: number
  ownerLevel: SoldierLevel
  nextAttackTick: number
  expiresAtTick: number
}

export interface PveEffectZoneSnapshot {
  id: string
  ownerPlayerId: string
  sourceGeneralId: string
  sourceFormationId: string
  effectId: string
  zoneId: string
  xMilli: number
  yMilli: number
  shape:
    | { kind: 'circle', radiusMilliCells: number }
    | { kind: 'line', lengthMilliCells: number, halfWidthMilliCells: number }
  nextTick: number
  expiresAtTick: number
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
  discardedCharacters: CharacterPiece[]
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
    | 'GENERAL_EFFECT_APPLIED'
    | 'GENERAL_STATUS_APPLIED'
    | 'GENERAL_STATUS_EXPIRED'
    | 'GENERAL_STATUS_CONSUMED'
    | 'STATUS_APPLIED'
    | 'STATUS_EXPIRED'
    | 'SUMMON_SPAWNED'
    | 'SUMMON_EXPIRED'
    | 'ZONE_SPAWNED'
    | 'ZONE_EXPIRED'
    | 'PATH_DISPLACED'
    | 'COOLDOWN_MODIFIED'
    | 'SYNERGY_ACTIVATED'
    | 'SYNERGY_DEACTIVATED'
    | 'SYNERGY_LEVEL_CHANGED'
    | 'SYNERGY_RECONFIGURED'
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
    | 'ACTIVE_ITEM_USED'
    | 'ACTIVE_ITEM_REJECTED'
    | 'CHARACTER_DISCARDED'
    | 'WEAPON_EFFECT_UNSUPPORTED'
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
  statuses: PveEnemyStatusSnapshot[]
  summonedUnits: PveSummonedUnitSnapshot[]
  zones: PveEffectZoneSnapshot[]
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

export interface UseActiveItemAction {
  type: 'USE_ACTIVE_ITEM'
  actionId: string
  requestId: string
  slotIndex: 0 | 1
  itemId: string
  target: import('../item-v1').ActiveItemTarget
  expectedItemRuntimeVersion: number
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
  | UseActiveItemAction

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
  /** 测试、回放和对局配置快照注入；未传时使用默认目录。 */
  generalCatalog?: Readonly<Record<string, GeneralDefinition>>
  /** 开局时冻结的局外道具配装；对局内不再读账户。 */
  itemLoadoutSnapshots?: Readonly<Record<string, import('../item-v1').MatchItemLoadoutSnapshot>>
  /** 开局时冻结的局外武器配装；对局内不再读账户。 */
  weaponLoadoutSnapshots?: Readonly<Record<string, import('../weapon-v1').MatchWeaponLoadoutSnapshot>>
}
import type { GeneralDefinition } from '../core/hero-v1/types'
