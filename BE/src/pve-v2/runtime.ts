import {
  getSoldierCatalogEntry,
  getSoldierLevelValue,
  SOLDIER_TYPES,
  validatePveV2Catalogs,
  type SoldierCatalogEntry,
  type WaveMinionCatalogEntry,
} from './catalogs'
import {
  resolvePveWaveCatalog,
  validatePveBalanceCatalog,
  type PveBalanceProfile,
} from './balance-catalog'
import {
  createPveLaneRoutes,
  hasEnemyBodyFullyExitedPveSpawnSquareMilli,
  isDefaultDeployableCell,
  PVE_ARENA_GRID_SIZE,
  PVE_LANE_SLOTS,
} from './arena'
import { DeterministicPrng } from './prng'
import { resolveBossEncounter, type ResolvedBossEncounterV1 } from './boss-catalog'
import {
  BossCombatRuntimeV1,
  isLaneWaveSpawningComplete,
  nextLaneSpawnEntityKind,
  settleBossControlDurationMs,
  settleEnemySlowBps,
  type BossRuntimeEnemyView,
} from './boss-runtime'
import {
  cumulativeExperienceRequiredForLevel,
  GENERAL_CATALOG,
  getGeneralLevelValue,
  resolveGeneralStats,
} from '../core/hero-v1/catalog'
import { DEFAULT_STARTER_GENERAL_IDS } from '../account-v1/service'
import {
  planGeneralCombatFrame,
  planGeneralPassiveTrigger,
} from '../core/hero-v1/combat-engine'
import { GeneralFormationManager } from '../core/hero-v1/formation-manager'
import { SUMMON_UNIT_CATALOG, type SummonUnitTemplate } from '../core/hero-v1/summon-catalog'
import type {
  GeneralCombatAction,
  GeneralDamageCombatAction,
  GeneralDefinition,
  GeneralFormationState,
  GeneralStatModifier,
  GeneralZoneTickEffectDefinition,
} from '../core/hero-v1/types'
import {
  GENERAL_SYNERGY_PROFILES,
  SYNERGY_V1_CATALOG,
  evaluatePlayerSynergies,
  reconcilePlayerSynergies,
  SynergyRuntimeProjectionRegistry,
  settleRuntimeSynergyParameter,
  settleRuntimeSynergyStat,
  type PlayerSynergyEvaluation,
  type SynergyStat,
} from '../synergy-v1'
import {
  createItemRuntimeAggregate,
  projectPassiveItemRules,
  resolveGeneralExperience,
  resolvePaidRecruitCost,
  useActiveItem,
  type ActiveItemTarget,
  type ItemRuntimeAggregate,
  type MatchItemLoadoutSnapshot,
  type PassiveRuleProjection,
} from '../item-v1'
import {
  projectWeaponLoadout,
  type MatchWeaponLoadoutSnapshot,
  type WeaponProjectionSource,
  type WeaponStat,
} from '../weapon-v1'
import type {
  CharacterPiece,
  MergeSoldiersAction,
  MoveBoardPieceAction,
  PveBoardPiece,
  PveEnemySnapshot,
  PveEnemyStatusSnapshot,
  PveGeneralStatusSnapshot,
  PveEffectZoneSnapshot,
  PveGameRuntimeOptions,
  PveGeneralSelection,
  PveLaneRoute,
  PveLaneSlot,
  PvePiece,
  PvePlayerSnapshot,
  PveRuntimeAction,
  PveRuntimeEvent,
  PveRuntimeResult,
  PveRuntimeSnapshot,
  PveSummonedUnitSnapshot,
  SoldierLevel,
  SoldierPiece,
  SwapTrayBoardAction,
  SwapReserveBoardAction,
  ExileReserveAction,
  SwapStoragePiecesAction,
  SetGeneralFixedAction,
  MoveFixedGeneralAction,
} from './types'
import { createPveMatchConfigSnapshot, type PveMatchConfigSnapshot } from './ruleset'
import {
  PVE_STARTING_RICE,
  allocatePveBaseXpByContribution,
  resolvePveLaneClearRiceReward,
  resolvePvePaidRecruitBaseCost,
} from './economy'

const TRAY_SIZE = 5
const RESERVE_SIZE = 2
const POPULATION_CAP = 10
const CHARACTER_BRANCH_BPS = 1000
const ENEMY_CAPACITY_PER_PLAYER = 10
const OVERLOAD_DURATION_MS = 10000
const XP_REWARD_POINTS = 1000

const SELF_GENERAL_STATUS_IDS = new Set([
  'next_basic_attack_damage_up',
  'attack_speed_up',
])

const CONTROL_STATUS_IDS = new Set([
  'slow',
  'stun',
  'root',
  'suppress',
  'suppress_active_trait',
])

/** 选关并开始对局后，首波与后续波次统一使用的准备时间。 */
export const PVE_WAVE_PREP_DURATION_MS = 5000

/**
 * 同一路出生器两次正常刷怪的最小间隔。
 *
 * 这只是刷怪调度规则，不是怪物碰撞或防重叠规则：怪物进入战场后仍可以被技能聚集在一起。
 */
export const PVE_MIN_LANE_SPAWN_INTERVAL_MS = 1500

export function resolvePveLaneSpawnIntervalMs(configuredIntervalMs: number): number {
  return Math.max(PVE_MIN_LANE_SPAWN_INTERVAL_MS, configuredIntervalMs)
}

interface BoardEntry {
  x: number
  y: number
  piece: PvePiece
}

interface PlayerRuntime {
  playerId: string
  slot: PveLaneSlot
  rice: number
  recruitCount: number
  populationCap: number
  trayRevision: number
  reserveRevision: number
  boardRevision: number
  tray: Array<PvePiece | null>
  reserve: Array<PvePiece | null>
  discardedCharacters: CharacterPiece[]
  board: Map<string, BoardEntry>
  remainingCharacterTokens: Map<string, number>
  clearedWaves: Set<number>
  noCharacterPaidRecruitBatches: number
  itemSnapshot: MatchItemLoadoutSnapshot | null
  passiveItems: PassiveRuleProjection | null
  itemRuntime: ItemRuntimeAggregate | null
  weaponSnapshot: MatchWeaponLoadoutSnapshot | null
  unlockedGeneralIds: string[]
  selectedGeneralIds: string[]
}

interface EnemyRuntime extends PveEnemySnapshot {
  lifecycle: 'alive' | 'dead'
  riceReward: number
  experiencePoints: number
  generalContributions: Map<string, {
    ownerPlayerId: string
    generalId: string
    category: 'physical' | 'magic' | 'summon' | 'control'
    lastContributionTick: number
  }>
}

interface DamageOverTimeRuntime {
  instanceId: string
  enemyId: string
  ownerPlayerId: string
  sourceGeneralId: string
  sourceFormationId: string
  damageType: 'physical' | 'magic' | 'true'
  baseAttack: number
  coefficientBpsPerTick: number
  flatDamagePerTick: number
  nextTick: number
  tickIntervalTicks: number
  expiresAtTick: number
  stackGroup: string
}

interface SummonedUnitRuntime extends PveSummonedUnitSnapshot {
  template: SummonUnitTemplate
  sourceEffectId: string
  inheritStatRatiosBps: Readonly<Partial<Record<'attack' | 'attackSpeed' | 'critRate' | 'critDamage' | 'damageDealt', number>>>
  sourceInactivePolicy: 'despawn' | 'finish_duration'
}

interface EffectZoneRuntime extends PveEffectZoneSnapshot {
  tickIntervalTicks: number
  tickEffects: readonly GeneralZoneTickEffectDefinition[]
  sourceInactivePolicy: 'despawn' | 'finish_duration'
}

interface LaneWaveRuntime {
  waveNumber: number
  playerId: string
  slot: PveLaneSlot
  spawnedCount: number
  totalCount: number
  nextSpawnTick: number
  lastSpawnedEnemyId: string | null
  bossEncounter: ResolvedBossEncounterV1 | null
  bossSpawned: boolean
  bossEnemyId: string | null
  clearRewardGranted: boolean
  retired: boolean
}

interface PveRuntimeCheckpointV1 {
  schemaVersion: 1
  combatRulesetVersion: string
  configSnapshot: PveMatchConfigSnapshot
  seed: string
  rngState: number
  players: Array<Omit<PlayerRuntime, 'board' | 'remainingCharacterTokens' | 'clearedWaves'> & {
    board: Array<[string, BoardEntry]>
    remainingCharacterTokens: Array<[string, number]>
    clearedWaves: number[]
  }>
  slotAssignments: Array<[PveLaneSlot, string]>
  processedActions: Array<[string, PveRuntimeResult]>
  generalFormations: Record<string, unknown>
  reportedUnsupportedWeaponEffects: string[]
  synergies: Array<[string, PlayerSynergyEvaluation]>
  bossRuntime: Record<string, unknown>
  enemies: Array<Omit<EnemyRuntime, 'generalContributions'> & {
    generalContributions: Array<[string, EnemyRuntime['generalContributions'] extends Map<string, infer V> ? V : never]>
  }>
  statuses: PveEnemyStatusSnapshot[]
  generalStatuses: PveGeneralStatusSnapshot[]
  damageOverTime: DamageOverTimeRuntime[]
  summonedUnits: SummonedUnitRuntime[]
  zones: EffectZoneRuntime[]
  effectParameterPatches: Array<[string, { operation: 'add_flat' | 'add_ratio' | 'multiply', value: number }]>
  pendingCombatActions: PveGameRuntime['pendingCombatActions']
  laneWaves: LaneWaveRuntime[]
  currentTick: number
  status: PveRuntimeSnapshot['status']
  /** Added after v1 checkpoints were already in circulation. */
  tutorialPaused?: boolean
  result: PveRuntimeSnapshot['result']
  currentWaveNumber: number
  pendingWaveNumber: number | null
  wavePhase: PveRuntimeSnapshot['wave']['phase']
  prepRemainingTicks: number
  playerCountAtStart: number
  enemyCapacity: number
  overloadTicks: number
  pieceSequence: number
  enemySequence: number
  eventSequence: number
  effectSequence: number
}

interface PieceLocation {
  kind: 'tray' | 'reserve' | 'board'
  trayIndex?: number
  reserveIndex?: number
  boardKey?: string
  boardX?: number
  boardY?: number
}

function boardKey(x: number, y: number): string {
  return `${x},${y}`
}

function isSoldier(piece: PvePiece | null | undefined): piece is SoldierPiece {
  return piece?.kind === 'soldier'
}

function clonePiece(piece: PvePiece): PvePiece {
  return { ...piece }
}

function slotOrder(slot: PveLaneSlot): number {
  return PVE_LANE_SLOTS.indexOf(slot)
}

function sanitizeCharacterTokens(tokens?: Record<string, number>): Map<string, number> {
  const result = new Map<string, number>()
  for (const [glyph, count] of Object.entries(tokens ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if ([...glyph].length !== 1 || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid character token config: ${glyph}`)
    }
    if (count > 0) {
      result.set(glyph, count)
    }
  }
  return result
}

function sanitizeWaveGlyphPools(
  pools: readonly (readonly string[])[] | undefined,
  maxWaves: number,
): readonly (readonly string[])[] | null {
  if (pools === undefined) {
    return null
  }
  if (pools.length < maxWaves) {
    throw new Error(`waveGlyphPools must define at least ${maxWaves} waves`)
  }
  return pools.slice(0, maxWaves).map((pool, index) => {
    const uniqueGlyphs = [...new Set(pool)]
    if (
      uniqueGlyphs.length < 1
      || uniqueGlyphs.length > 4
      || uniqueGlyphs.some((glyph) => [...glyph].length !== 1)
    ) {
      throw new Error(`Invalid wave glyph pool at wave ${index + 1}`)
    }
    return uniqueGlyphs
  })
}

function validateRuntimeOptions(options: PveGameRuntimeOptions): void {
  if (!Number.isInteger(options.tickRateMs ?? 100) || (options.tickRateMs ?? 100) <= 0) {
    throw new Error('tickRateMs must be a positive integer')
  }
  if (
    !Number.isInteger(options.prepDurationMs ?? PVE_WAVE_PREP_DURATION_MS)
    || (options.prepDurationMs ?? PVE_WAVE_PREP_DURATION_MS) < 0
  ) {
    throw new Error('prepDurationMs must be a non-negative integer')
  }
  if (options.tutorialPrepDurationMs !== undefined
    && (!Number.isInteger(options.tutorialPrepDurationMs) || options.tutorialPrepDurationMs < 0)) {
    throw new Error('tutorialPrepDurationMs must be a non-negative integer')
  }
  if (!Number.isInteger(options.maxWaves ?? 20) || (options.maxWaves ?? 20) < 1 || (options.maxWaves ?? 20) > 20) {
    throw new Error('maxWaves must be an integer between 1 and 20')
  }
  if (!Number.isInteger(options.initialWaveNumber ?? 1)
    || (options.initialWaveNumber ?? 1) < 1
    || (options.initialWaveNumber ?? 1) > (options.maxWaves ?? 20)) {
    throw new Error('initialWaveNumber must be between 1 and maxWaves')
  }
}

function normalizeGeneralSelection(
  selection: PveGeneralSelection | undefined,
  catalog: Readonly<Record<string, GeneralDefinition>>,
): { unlockedGeneralIds: string[], selectedGeneralIds: string[] } {
  const all = Object.keys(catalog).sort()
  if (!selection) return { unlockedGeneralIds: all, selectedGeneralIds: all }
  const unlocked = [...new Set(selection.unlockedGeneralIds)].sort()
  const selected = [...new Set(selection.selectedGeneralIds)].sort()
  if (selected.length === 0) throw new Error('EMPTY_SELECTED_GENERAL')
  if (unlocked.some((id) => !catalog[id])) throw new Error('UNKNOWN_UNLOCKED_GENERAL')
  if (selected.some((id) => !catalog[id])) throw new Error('UNKNOWN_SELECTED_GENERAL')
  const unlockedSet = new Set(unlocked)
  if (selected.some((id) => !unlockedSet.has(id))) throw new Error('SELECTED_GENERAL_NOT_UNLOCKED')
  return { unlockedGeneralIds: unlocked, selectedGeneralIds: selected }
}

/** Recompute the legal character glyphs for a frozen general selection. */
function selectionGlyphs(
  selectedGeneralIds: readonly string[],
  catalog: Readonly<Record<string, GeneralDefinition>>,
): ReadonlySet<string> {
  const glyphs = new Set<string>()
  for (const generalId of selectedGeneralIds) {
    const definition = catalog[generalId]
    if (!definition) continue
    for (const glyph of definition.recipe.glyphs) glyphs.add(glyph)
  }
  return glyphs
}

export class PveGameRuntime {
  private readonly tickRateMs: number

  private seed: string

  private readonly prng: DeterministicPrng

  private readonly prepDurationTicks: number

  private readonly tutorialPrepDurationTicks: number

  private readonly maxWaves: number

  private readonly initialWaveNumber: number

  private readonly laneRoutes: Record<PveLaneSlot, PveLaneRoute>

  private readonly isDeployableCell: (slot: PveLaneSlot, x: number, y: number) => boolean

  private readonly initialCharacterTokens: Map<string, number>

  private readonly generalSelections: Readonly<Record<string, PveGeneralSelection>>

  private readonly waveGlyphPools: readonly (readonly string[])[] | null

  /** 本局冻结后的数值表，不会随账户解锁或配置热更改变。 */
  private readonly balanceProfile: PveBalanceProfile

  private readonly waveCatalog: readonly WaveMinionCatalogEntry[]

  private readonly eventHistoryLimit: number

  private readonly eventObserver: ((event: PveRuntimeEvent) => void) | null

  private readonly players = new Map<string, PlayerRuntime>()

  private readonly slotAssignments = new Map<PveLaneSlot, string>()

  private readonly processedActions = new Map<string, PveRuntimeResult>()

  private readonly recentEvents: PveRuntimeEvent[] = []

  private readonly generalCatalog: Readonly<Record<string, GeneralDefinition>>

  private readonly generalFormations: GeneralFormationManager

  private readonly itemLoadoutSnapshots: Readonly<Record<string, MatchItemLoadoutSnapshot>>

  private readonly weaponLoadoutSnapshots: Readonly<Record<string, MatchWeaponLoadoutSnapshot>>

  private readonly reportedUnsupportedWeaponEffects = new Set<string>()

  private readonly synergyByPlayer = new Map<string, PlayerSynergyEvaluation>()

  /** 羁绊效果唯一运行时来源；重配与失活由 reconcile commands 精确替换/移除。 */
  private readonly synergyEffects = new SynergyRuntimeProjectionRegistry(GENERAL_SYNERGY_PROFILES)

  private readonly bossRuntime: BossCombatRuntimeV1

  private readonly configSnapshot: Readonly<PveMatchConfigSnapshot>

  private enemies: EnemyRuntime[] = []

  private statuses: PveEnemyStatusSnapshot[] = []

  /** 神将自身 buff 与敌方 debuff 分开存储，避免 self targeting 被误解为敌人状态。 */
  private generalStatuses: PveGeneralStatusSnapshot[] = []

  private damageOverTime: DamageOverTimeRuntime[] = []

  private summonedUnits: SummonedUnitRuntime[] = []

  private zones: EffectZoneRuntime[] = []

  /**
   * 参数补丁按玩家、神将阵型、目标效果、参数、补丁来源效果和主动/被动来源共同隔离。
   * 同一个补丁重复触发会刷新自身，不会覆盖另一个主动/被动补丁；读取时再按稳定键顺序组合。
   */
  private readonly effectParameterPatches = new Map<string, { operation: 'add_flat' | 'add_ratio' | 'multiply', value: number }>()

  private pendingCombatActions: Array<{
    dueTick: number
    playerId: string
    formation: GeneralFormationState
    level: 1 | 2 | 3 | 4 | 5
    action: GeneralCombatAction
  }> = []

  private laneWaves: LaneWaveRuntime[] = []

  private currentTick = 0

  private status: PveRuntimeSnapshot['status'] = 'waiting'

  private tutorialPaused = false

  private result: PveRuntimeSnapshot['result'] = null

  private currentWaveNumber = 0

  private pendingWaveNumber: number | null = null

  private wavePhase: PveRuntimeSnapshot['wave']['phase'] = 'idle'

  private prepRemainingTicks = 0

  private playerCountAtStart = 0

  private enemyCapacity = 0

  private overloadTicks = 0

  private pieceSequence = 0

  private enemySequence = 0

  private eventSequence = 0

  private effectSequence = 0

  constructor(options: PveGameRuntimeOptions) {
    validatePveV2Catalogs()
    validatePveBalanceCatalog()
    validateRuntimeOptions(options)
    this.tickRateMs = options.tickRateMs ?? 100
    this.seed = String(options.seed)
    this.prng = new DeterministicPrng(options.seed)
    this.prepDurationTicks = Math.ceil(
      (options.prepDurationMs ?? PVE_WAVE_PREP_DURATION_MS) / this.tickRateMs,
    )
    this.tutorialPrepDurationTicks = options.tutorialPrepDurationMs === undefined
      ? this.prepDurationTicks
      : Math.ceil(options.tutorialPrepDurationMs / this.tickRateMs)
    this.maxWaves = options.maxWaves ?? 20
    this.initialWaveNumber = options.initialWaveNumber ?? 1
    this.laneRoutes = createPveLaneRoutes(options.laneRoutes)
    this.isDeployableCell = options.isDeployableCell ?? isDefaultDeployableCell
    this.initialCharacterTokens = sanitizeCharacterTokens(options.characterTokens)
    this.waveGlyphPools = sanitizeWaveGlyphPools(options.waveGlyphPools, this.maxWaves)
    const resolvedBalance = resolvePveWaveCatalog(options.levelId ?? 1, options.difficulty ?? 'easy')
    this.balanceProfile = resolvedBalance.profile
    this.waveCatalog = resolvedBalance.waves
    this.configSnapshot = createPveMatchConfigSnapshot({
      levelId: options.levelId ?? 1,
      difficulty: options.difficulty ?? 'easy',
      balanceProfile: this.balanceProfile,
      tickRateMs: this.tickRateMs,
      prepDurationMs: this.prepDurationTicks * this.tickRateMs,
      maxWaves: this.maxWaves,
      initialWaveNumber: this.initialWaveNumber,
    })
    this.eventHistoryLimit = Math.max(20, options.eventHistoryLimit ?? 300)
    this.eventObserver = options.eventObserver ?? null
    this.generalCatalog = options.generalCatalog ?? GENERAL_CATALOG
    this.generalSelections = structuredClone(options.generalSelections ?? {})
    this.itemLoadoutSnapshots = structuredClone(options.itemLoadoutSnapshots ?? {})
    this.weaponLoadoutSnapshots = structuredClone(options.weaponLoadoutSnapshots ?? {})
    this.generalFormations = new GeneralFormationManager(this.generalCatalog)
    this.bossRuntime = new BossCombatRuntimeV1(this.tickRateMs)
  }

  registerPlayer(playerId: string, slot: PveLaneSlot, selection?: PveGeneralSelection): PveRuntimeResult {
    if (this.status !== 'waiting') {
      return this.commandResult(false, 'MATCH_ALREADY_STARTED')
    }
    if (!playerId.trim() || !PVE_LANE_SLOTS.includes(slot)) {
      return this.commandResult(false, 'INVALID_PLAYER_OR_SLOT')
    }
    if (this.players.has(playerId)) {
      return this.commandResult(false, 'PLAYER_ALREADY_REGISTERED')
    }
    if (this.slotAssignments.has(slot)) {
      return this.commandResult(false, 'SLOT_OCCUPIED')
    }

    const itemSnapshot = this.itemLoadoutSnapshots[playerId] ?? null
    const weaponSnapshot = this.weaponLoadoutSnapshots[playerId] ?? null
    if ((itemSnapshot && itemSnapshot.playerId !== playerId) || (weaponSnapshot && weaponSnapshot.playerId !== playerId)) {
      return this.commandResult(false, 'LOADOUT_PLAYER_MISMATCH')
    }
    const passiveItems = itemSnapshot ? projectPassiveItemRules(this.seed, itemSnapshot) : null
    let normalizedSelection: { unlockedGeneralIds: string[], selectedGeneralIds: string[] }
    try {
      normalizedSelection = normalizeGeneralSelection(selection ?? this.generalSelections[playerId], this.generalCatalog)
    } catch (error) {
      return this.commandResult(false, error instanceof Error ? error.message : 'INVALID_GENERAL_SELECTION')
    }
    const selectedTokenCounts: Record<string, number> = {}
    for (const generalId of normalizedSelection.selectedGeneralIds) {
      const definition = this.generalCatalog[generalId]
      for (const glyph of definition.recipe.glyphs) selectedTokenCounts[glyph] = (selectedTokenCounts[glyph] ?? 0) + 1
    }
    const player: PlayerRuntime = {
      playerId,
      slot,
      rice: PVE_STARTING_RICE + (passiveItems?.startingRationsBonus ?? 0),
      recruitCount: 0,
      populationCap: POPULATION_CAP + (passiveItems?.populationCapBonus ?? 0),
      trayRevision: 0,
      reserveRevision: 0,
      boardRevision: 0,
      tray: Array<PvePiece | null>(TRAY_SIZE).fill(null),
      reserve: Array<PvePiece | null>(RESERVE_SIZE + (passiveItems?.reserveCapacityBonus ?? 0)).fill(null),
      discardedCharacters: [],
      board: new Map(),
      remainingCharacterTokens: selection || this.generalSelections[playerId]
        ? sanitizeCharacterTokens(selectedTokenCounts)
        : new Map(this.initialCharacterTokens),
      clearedWaves: new Set(),
      noCharacterPaidRecruitBatches: 0,
      itemSnapshot,
      passiveItems,
      itemRuntime: itemSnapshot ? createItemRuntimeAggregate(this.seed, itemSnapshot) : null,
      weaponSnapshot,
      unlockedGeneralIds: normalizedSelection.unlockedGeneralIds,
      selectedGeneralIds: normalizedSelection.selectedGeneralIds,
    }
    this.players.set(playerId, player)
    this.slotAssignments.set(slot, playerId)
    return this.commandResult(true, 'PLAYER_REGISTERED')
  }

  unregister(playerId: string): PveRuntimeResult {
    const player = this.players.get(playerId)
    if (!player) {
      return this.commandResult(false, 'PLAYER_NOT_FOUND')
    }
    if (this.status === 'running') {
      const currentLane = this.laneWaves.find((lane) => (
        lane.waveNumber === this.currentWaveNumber
        && lane.playerId === playerId
        && lane.slot === player.slot
      ))
      if (currentLane) {
        currentLane.totalCount = currentLane.spawnedCount
        currentLane.retired = true
      }
    }
    this.synergyEffects.removePlayer(playerId)
    this.synergyByPlayer.delete(playerId)
    this.players.delete(playerId)
    this.slotAssignments.delete(player.slot)
    return this.commandResult(true, 'PLAYER_UNREGISTERED')
  }

  start(): PveRuntimeResult {
    if (this.status !== 'waiting') {
      return this.commandResult(false, 'MATCH_ALREADY_STARTED')
    }
    if (this.players.size === 0) {
      return this.commandResult(false, 'NO_PLAYERS')
    }

    this.status = 'running'
    this.playerCountAtStart = this.players.size
    this.enemyCapacity = this.playerCountAtStart * ENEMY_CAPACITY_PER_PLAYER
    this.prepareWave(this.initialWaveNumber)
    this.emit('MATCH_STARTED', {
      playerCount: this.playerCountAtStart,
      enemyCapacity: this.enemyCapacity,
      seed: this.seed,
      levelId: this.balanceProfile.levelId,
      difficulty: this.balanceProfile.difficulty,
      balanceProfileId: this.balanceProfile.profileId,
    })
    if (this.prepRemainingTicks === 0) {
      this.beginPreparedWave()
    }
    return this.commandResult(true, 'MATCH_STARTED')
  }

  handleAction(playerId: string, action: PveRuntimeAction): PveRuntimeResult {
    const actionKey = `${playerId}:${action.actionId}`
    const existing = this.processedActions.get(actionKey)
    if (existing) {
      return { ...existing, details: existing.details ? { ...existing.details } : undefined }
    }

    let result: PveRuntimeResult
    if (!action.actionId.trim()) {
      result = this.actionResult(action, false, 'INVALID_ACTION_ID')
    }
    else if (this.status === 'finished') {
      result = this.actionResult(action, false, 'MATCH_FINISHED')
    }
    else {
      const player = this.players.get(playerId)
      if (!player) {
        result = this.actionResult(action, false, 'PLAYER_NOT_FOUND')
      }
      else {
        switch (action.type) {
          case 'SET_TUTORIAL_PAUSED':
            result = this.setTutorialPaused(action)
            break
          case 'RECRUIT_BATCH':
            result = this.handleRecruit(player, action)
            break
          case 'SWAP_TRAY_BOARD':
            result = this.handleSwapTrayBoard(player, action)
            break
          case 'MOVE_BOARD_PIECE':
            result = this.handleMoveBoardPiece(player, action)
            break
          case 'MERGE_SOLDIERS':
            result = this.handleMergeSoldiers(player, action)
            break
          case 'SWAP_RESERVE_BOARD':
            result = this.handleSwapReserveBoard(player, action)
            break
          case 'EXILE_RESERVE':
            result = this.handleExileReserve(player, action)
            break
          case 'SWAP_STORAGE_PIECES':
            result = this.handleSwapStoragePieces(player, action)
            break
          case 'SET_GENERAL_FIXED':
            result = this.handleSetGeneralFixed(player, action)
            break
          case 'MOVE_FIXED_GENERAL':
            result = this.handleMoveFixedGeneral(player, action)
            break
          case 'USE_ACTIVE_ITEM':
            result = this.handleUseActiveItem(player, action)
            break
        }
      }
    }

    this.processedActions.set(actionKey, result)
    return { ...result, details: result.details ? { ...result.details } : undefined }
  }

  tick(): PveRuntimeSnapshot {
    if (this.status !== 'running' || this.tutorialPaused) {
      return this.snapshot()
    }

    this.currentTick += 1

    if (this.wavePhase === 'prep') {
      this.prepRemainingTicks = Math.max(0, this.prepRemainingTicks - 1)
      if (this.prepRemainingTicks === 0) {
        this.beginPreparedWave()
      }
    }

    this.spawnDueEnemies()
    this.expireEffectInstances()
    this.advanceBossSkills()
    this.resolvePendingCombatActions()
    this.moveEnemies()
    this.resolveDamageOverTime()
    this.resolveZones()
    this.resolveSummonedUnitAttacks()
    this.resolveSoldierAttacks()
    this.resolveGeneralAttacks()
    this.enemies = this.enemies.filter((enemy) => enemy.lifecycle === 'alive')
    this.removeEffectsForMissingEnemies()
    this.updateLaneClearRewards()
    this.updateWavePhaseAndProgression()
    this.evaluateOverload()

    return this.snapshot()
  }

  snapshot(): PveRuntimeSnapshot {
    const overloadLimitTicks = Math.ceil(OVERLOAD_DURATION_MS / this.tickRateMs)
    const players = [...this.players.values()]
      .sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot))
      .map((player) => this.playerSnapshot(player))

    return {
      schemaVersion: 2,
      combatRulesetVersion: this.configSnapshot.combatRulesetVersion,
      configSnapshot: structuredClone(this.configSnapshot),
      tick: this.currentTick,
      tickRateMs: this.tickRateMs,
      seed: this.seed,
      rngState: this.prng.snapshot(),
      status: this.status,
      tutorialPaused: this.tutorialPaused,
      result: this.result ? { ...this.result } : null,
      balance: {
        profileId: this.balanceProfile.profileId,
        levelId: this.balanceProfile.levelId,
        difficulty: this.balanceProfile.difficulty,
        enemyHpMultiplierBps: this.balanceProfile.enemyHpMultiplierBps,
        enemyDefenseAdd: this.balanceProfile.enemyDefenseAdd,
      },
      playerCountAtStart: this.playerCountAtStart,
      enemyCapacity: this.enemyCapacity,
      overloadTicks: this.overloadTicks,
      overloadCountdownMs: this.overloadTicks > 0
        ? Math.max(0, overloadLimitTicks - this.overloadTicks) * this.tickRateMs
        : 0,
      wave: {
        number: this.currentWaveNumber,
        maxWaves: this.maxWaves,
        phase: this.wavePhase,
        prepRemainingTicks: this.prepRemainingTicks,
        lanes: this.currentLaneWaves()
          .slice()
          .sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot))
          .map((lane) => ({
            playerId: lane.playerId,
            slot: lane.slot,
            spawnedCount: lane.spawnedCount,
            totalCount: lane.totalCount,
            bossRequired: lane.bossEncounter !== null,
            bossSpawned: lane.bossSpawned,
            bossEnemyId: lane.bossEnemyId,
            cleared: lane.spawnedCount >= lane.totalCount
              && (!lane.bossEncounter || lane.bossSpawned || lane.retired)
              && !this.hasAliveLaneEnemy(lane),
            clearRewardGranted: lane.clearRewardGranted,
            retired: lane.retired,
          })),
      },
      players,
      enemies: this.enemies
        .filter((enemy) => enemy.lifecycle === 'alive')
        .slice()
        .sort((left, right) => left.spawnSequence - right.spawnSequence)
        .map(({ lifecycle: _lifecycle, generalContributions: _generalContributions,
          riceReward: _riceReward, experiencePoints: _experiencePoints, ...enemy }) => ({ ...enemy })),
      statuses: this.statuses
        .slice()
        .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
        .map((status) => ({ ...status })),
      summonedUnits: this.summonedUnits
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ template: _template, inheritStatRatiosBps: _inherit, sourceEffectId: _sourceEffectId, ...summon }) => ({ ...summon })),
      zones: this.zones
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ tickIntervalTicks: _interval, tickEffects: _effects, ...zone }) => ({ ...zone })),
      bossRuntime: this.bossRuntime.snapshot(),
      recentEvents: this.recentEvents.map((event) => ({
        ...event,
        data: structuredClone(event.data),
      })),
    }
  }

  /**
   * Authoritative, JSON-compatible checkpoint. recentEvents are intentionally excluded:
   * recovery continues simulation state but never replays historical presentation/VFX.
   */
  exportCheckpoint(): Record<string, unknown> {
    const checkpoint: PveRuntimeCheckpointV1 = {
      schemaVersion: 1,
      combatRulesetVersion: this.configSnapshot.combatRulesetVersion,
      configSnapshot: structuredClone(this.configSnapshot),
      seed: this.seed,
      rngState: this.prng.snapshot(),
      players: [...this.players.values()].sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot)).map((player) => ({
        ...structuredClone(player),
        board: [...player.board.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, structuredClone(value)]),
        remainingCharacterTokens: [...player.remainingCharacterTokens.entries()].sort(([left], [right]) => left.localeCompare(right)),
        clearedWaves: [...player.clearedWaves].sort((left, right) => left - right),
      })),
      slotAssignments: [...this.slotAssignments.entries()].sort(([left], [right]) => slotOrder(left) - slotOrder(right)),
      processedActions: [...this.processedActions.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, structuredClone(value)]),
      generalFormations: this.generalFormations.exportCheckpoint(),
      reportedUnsupportedWeaponEffects: [...this.reportedUnsupportedWeaponEffects].sort(),
      synergies: [...this.synergyByPlayer.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, structuredClone(value)]),
      bossRuntime: this.bossRuntime.exportCheckpoint(),
      enemies: this.enemies.map((enemy) => ({
        ...structuredClone(enemy),
        generalContributions: [...enemy.generalContributions.entries()].sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, structuredClone(value)]),
      })),
      statuses: structuredClone(this.statuses),
      generalStatuses: structuredClone(this.generalStatuses),
      damageOverTime: structuredClone(this.damageOverTime),
      summonedUnits: structuredClone(this.summonedUnits),
      zones: structuredClone(this.zones),
      effectParameterPatches: [...this.effectParameterPatches.entries()].sort(([left], [right]) => left.localeCompare(right)),
      pendingCombatActions: structuredClone(this.pendingCombatActions),
      laneWaves: structuredClone(this.laneWaves),
      currentTick: this.currentTick,
      status: this.status,
      result: this.result ? structuredClone(this.result) : null,
      currentWaveNumber: this.currentWaveNumber,
      pendingWaveNumber: this.pendingWaveNumber,
      wavePhase: this.wavePhase,
      prepRemainingTicks: this.prepRemainingTicks,
      playerCountAtStart: this.playerCountAtStart,
      enemyCapacity: this.enemyCapacity,
      overloadTicks: this.overloadTicks,
      pieceSequence: this.pieceSequence,
      enemySequence: this.enemySequence,
      eventSequence: this.eventSequence,
      effectSequence: this.effectSequence,
      tutorialPaused: this.tutorialPaused,
    }
    return structuredClone(checkpoint) as unknown as Record<string, unknown>
  }

  restoreCheckpoint(raw: Record<string, unknown>): void {
    const checkpoint = structuredClone(raw) as unknown as PveRuntimeCheckpointV1
    if (checkpoint.schemaVersion !== 1
      || checkpoint.combatRulesetVersion !== this.configSnapshot.combatRulesetVersion
      || JSON.stringify(checkpoint.configSnapshot) !== JSON.stringify(this.configSnapshot)) {
      throw new Error('PVE_CHECKPOINT_RULESET_OR_CONFIG_MISMATCH')
    }
    if (!Array.isArray(checkpoint.players) || !Array.isArray(checkpoint.enemies)
      || !Array.isArray(checkpoint.processedActions) || !Number.isSafeInteger(checkpoint.currentTick)) {
      throw new Error('PVE_CHECKPOINT_INVALID')
    }

    const allPlayerIds = new Set([...this.players.keys(), ...checkpoint.players.map((player) => player.playerId)])
    for (const playerId of allPlayerIds) this.synergyEffects.removePlayer(playerId)
    this.players.clear()
    for (const stored of checkpoint.players) {
      // Build snapshots are authoritative when restoring a room. Older
      // checkpoints may have been created before the unlock gate and contain
      // a full-catalog token map (including 佛/净/悟); filter those tokens
      // before they can be recruited after a restart.
      const configuredSelection = this.generalSelections[stored.playerId]
      const checkpointSelection = stored.selectedGeneralIds && stored.selectedGeneralIds.length > 0
        ? {
            unlockedGeneralIds: stored.unlockedGeneralIds ?? stored.selectedGeneralIds,
            selectedGeneralIds: stored.selectedGeneralIds,
          }
        : {
            unlockedGeneralIds: [...DEFAULT_STARTER_GENERAL_IDS],
            selectedGeneralIds: [...DEFAULT_STARTER_GENERAL_IDS],
          }
      const normalizedSelection = normalizeGeneralSelection(
        configuredSelection ?? checkpointSelection,
        this.generalCatalog,
      )
      const allowedGlyphs = selectionGlyphs(normalizedSelection.selectedGeneralIds, this.generalCatalog)
      const remainingCharacterTokens = new Map(
        stored.remainingCharacterTokens.filter(([glyph, count]) => allowedGlyphs.has(glyph) && count > 0),
      )
      const player: PlayerRuntime = {
        ...structuredClone(stored),
        unlockedGeneralIds: normalizedSelection.unlockedGeneralIds,
        selectedGeneralIds: normalizedSelection.selectedGeneralIds,
        board: new Map(stored.board.map(([key, value]) => [key, structuredClone(value)])),
        remainingCharacterTokens,
        clearedWaves: new Set(stored.clearedWaves),
      }
      this.players.set(player.playerId, player)
    }
    this.slotAssignments.clear()
    for (const [slot, playerId] of checkpoint.slotAssignments) this.slotAssignments.set(slot, playerId)
    this.processedActions.clear()
    for (const [key, value] of checkpoint.processedActions) this.processedActions.set(key, structuredClone(value))
    this.generalFormations.restoreCheckpoint(checkpoint.generalFormations)
    this.reportedUnsupportedWeaponEffects.clear()
    for (const key of checkpoint.reportedUnsupportedWeaponEffects) this.reportedUnsupportedWeaponEffects.add(key)
    this.synergyByPlayer.clear()
    for (const [playerId, next] of checkpoint.synergies) {
      const previous: PlayerSynergyEvaluation = { ownerPlayerId: playerId, activeGeneralIds: [], activeSynergies: [] }
      const reconciliation = reconcilePlayerSynergies({ previous, next, definitions: SYNERGY_V1_CATALOG })
      this.synergyEffects.applyReconcileCommands({ ownerPlayerId: playerId, commands: reconciliation.commands })
      this.synergyByPlayer.set(playerId, structuredClone(next))
    }
    this.bossRuntime.restoreCheckpoint(checkpoint.bossRuntime)
    this.enemies = checkpoint.enemies.map((enemy) => ({
      ...structuredClone(enemy),
      generalContributions: new Map(enemy.generalContributions.map(([key, value]) => [key, structuredClone(value)])),
    }))
    this.statuses = structuredClone(checkpoint.statuses)
    this.generalStatuses = structuredClone(checkpoint.generalStatuses)
    this.damageOverTime = structuredClone(checkpoint.damageOverTime)
    this.summonedUnits = structuredClone(checkpoint.summonedUnits)
    this.zones = structuredClone(checkpoint.zones)
    this.effectParameterPatches.clear()
    for (const [key, value] of checkpoint.effectParameterPatches) this.effectParameterPatches.set(key, structuredClone(value))
    this.pendingCombatActions = structuredClone(checkpoint.pendingCombatActions)
    this.laneWaves = structuredClone(checkpoint.laneWaves)
    this.currentTick = checkpoint.currentTick
    this.status = checkpoint.status
    this.result = checkpoint.result ? structuredClone(checkpoint.result) : null
    this.currentWaveNumber = checkpoint.currentWaveNumber
    this.pendingWaveNumber = checkpoint.pendingWaveNumber
    this.wavePhase = checkpoint.wavePhase
    this.prepRemainingTicks = checkpoint.prepRemainingTicks
    this.playerCountAtStart = checkpoint.playerCountAtStart
    this.enemyCapacity = checkpoint.enemyCapacity
    this.overloadTicks = checkpoint.overloadTicks
    this.pieceSequence = checkpoint.pieceSequence
    this.enemySequence = checkpoint.enemySequence
    this.eventSequence = checkpoint.eventSequence
    this.effectSequence = checkpoint.effectSequence
    this.tutorialPaused = checkpoint.tutorialPaused === true
    this.prng.restore(checkpoint.rngState)
    this.seed = checkpoint.seed
    this.recentEvents.length = 0
  }

  private setTutorialPaused(action: Extract<PveRuntimeAction, { type: 'SET_TUTORIAL_PAUSED' }>): PveRuntimeResult {
    if (this.status !== 'running') return this.actionResult(action, false, 'MATCH_NOT_RUNNING')
    if (action.paused && this.currentWaveNumber > 5) return this.actionResult(action, false, 'TUTORIAL_WINDOW_EXPIRED')
    this.tutorialPaused = action.paused
    this.emit(action.paused ? 'TUTORIAL_PAUSED' : 'TUTORIAL_RESUMED', { paused: action.paused }, { actionId: action.actionId })
    return this.actionResult(action, true, action.paused ? 'TUTORIAL_PAUSED' : 'TUTORIAL_RESUMED')
  }

  discardPresentationEvents(): void {
    this.recentEvents.length = 0
  }

  /**
   * 未来 Boss/精英怪主动特性的统一门禁。
   * 它故意不与眩晕、定身或普通移动共用，调用方只应在尝试释放“主动特性”时查询。
   */
  isEnemyActiveTraitSuppressed(enemyId: string): boolean {
    return this.hasEnemyStatus(enemyId, 'suppress_active_trait')
  }

  private handleRecruit(player: PlayerRuntime, action: Extract<PveRuntimeAction, { type: 'RECRUIT_BATCH' }>): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedTrayRevision, player.trayRevision)) {
      return this.actionResult(action, false, 'STALE_TRAY_REVISION')
    }
    const cost = this.nextRecruitCost(player)
    if (player.rice < cost) {
      return this.actionResult(action, false, 'INSUFFICIENT_RICE', { required: cost, available: player.rice })
    }

    this.discardStorageCharacters(player, player.tray)
    const pity = player.passiveItems?.characterPity
    const shouldForcePityCharacter = Boolean(pity
      && player.noCharacterPaidRecruitBatches >= pity.triggerAfterNoCharacterBatches
      && player.remainingCharacterTokens.size > 0)
    const forcedCharacterIndex = shouldForcePityCharacter ? this.prng.pickIndex(TRAY_SIZE) : -1
    const nextTray = Array.from({ length: TRAY_SIZE }, (_, index) => (
      this.drawRecruitPiece(player, index === forcedCharacterIndex)
    ))
    let firstBatchSoldierForced = false
    if (player.recruitCount === 0 && nextTray.filter((piece) => piece.kind === 'soldier').length === 0) {
      const replacementIndex = this.prng.pickIndex(TRAY_SIZE)
      const replaced = nextTray[replacementIndex]
      if (replaced.kind === 'character') {
        player.remainingCharacterTokens.set(
          replaced.glyph,
          (player.remainingCharacterTokens.get(replaced.glyph) ?? 0) + 1,
        )
      }
      nextTray[replacementIndex] = this.createSoldierPiece(player.playerId, this.drawSoldierType(), 1, 0)
      firstBatchSoldierForced = true
    }

    player.rice -= cost
    player.recruitCount += 1
    const characterCount = nextTray.filter((piece) => piece.kind === 'character').length
    player.noCharacterPaidRecruitBatches = characterCount > 0
      ? 0
      : player.noCharacterPaidRecruitBatches + 1
    player.tray = nextTray
    player.trayRevision += 1
    this.emit('RECRUITED', {
      playerId: player.playerId,
      cost,
      recruitCount: player.recruitCount,
      nextRecruitCost: this.nextRecruitCost(player),
      firstBatchSoldierForced,
      characterPityForced: shouldForcePityCharacter,
      pieceIds: nextTray.map((piece) => piece.id),
    })
    return this.actionResult(action, true, 'RECRUITED', {
      cost,
      nextRecruitCost: this.nextRecruitCost(player),
      firstBatchSoldierForced,
    })
  }

  private handleUseActiveItem(
    player: PlayerRuntime,
    action: Extract<PveRuntimeAction, { type: 'USE_ACTIVE_ITEM' }>,
  ): PveRuntimeResult {
    if (!player.itemRuntime) return this.actionResult(action, false, 'ITEM_NOT_EQUIPPED')
    const wasProcessed = Boolean(player.itemRuntime.processedRequests[action.requestId])
    const use = useActiveItem(player.itemRuntime, {
      type: 'USE_ACTIVE_ITEM',
      requestId: action.requestId,
      playerId: player.playerId,
      slotIndex: action.slotIndex,
      itemId: action.itemId,
      target: action.target,
      expectedItemRuntimeVersion: action.expectedItemRuntimeVersion,
    }, {
      currentTick: this.currentTick,
      tickDurationMs: this.tickRateMs,
      phase: this.itemMatchPhase(),
      validateTarget: (definition, target) => this.validateActiveItemTarget(player, definition.itemId, target),
    })
    player.itemRuntime = use.state
    if (!use.ok) {
      this.emit('ACTIVE_ITEM_REJECTED', { playerId: player.playerId, itemId: action.itemId, error: use.error })
      return this.actionResult(action, false, use.error, { itemRuntimeVersion: use.runtimeVersion })
    }
    if (wasProcessed) {
      return this.actionResult(action, true, 'ACTIVE_ITEM_REPLAYED', { itemRuntimeVersion: use.runtimeVersion })
    }
    this.executeActiveItemPlan(player, use.plan.target, use.plan.actions, use.plan.effects, use.plan.sourceKey)
    this.emit('ACTIVE_ITEM_USED', {
      playerId: player.playerId,
      itemId: action.itemId,
      slotIndex: action.slotIndex,
      requestId: action.requestId,
      itemRuntimeVersion: use.runtimeVersion,
    })
    return this.actionResult(action, true, 'ACTIVE_ITEM_USED', { itemRuntimeVersion: use.runtimeVersion })
  }

  private itemMatchPhase(): 'idle' | 'prep' | 'spawning' | 'clearing' | 'complete' {
    if (this.status === 'waiting') return 'idle'
    if (this.status === 'finished' || this.wavePhase === 'complete') return 'complete'
    return this.wavePhase === 'idle' ? 'prep' : this.wavePhase
  }

  private validateActiveItemTarget(player: PlayerRuntime, itemId: string, target: ActiveItemTarget) {
    if (target.kind === 'none') return { ok: true }
    if (target.kind === 'general') {
      const progress = this.generalFormations.getProgress(player.playerId, target.generalId)
      if (!progress || !this.isGeneralActive(player.playerId, target.generalId)) return { ok: false, error: 'INVALID_ITEM_TARGET' as const }
      if ((itemId === 'cultivation_pill' || itemId === 'general_ascension_talisman') && progress.level >= progress.maxLevel) {
        return { ok: false, error: 'GENERAL_LEVEL_CAP_REACHED' as const }
      }
      return { ok: true }
    }
    if (target.kind === 'piece') {
      const located = this.locateOwnedPiece(player, target.pieceId)
      if (!located || located.piece.kind !== 'character') return { ok: false, error: 'INVALID_ITEM_TARGET' as const }
      const character = located.piece
      if (located.revision !== target.expectedRevision) return { ok: false, error: 'TARGET_REVISION_MISMATCH' as const }
      if (this.isPieceInFixedFormation(player.playerId, target.pieceId)) return { ok: false, error: 'FIXED_GENERAL_MUST_BE_RELEASED' as const }
      const hasCandidate = [...player.remainingCharacterTokens.entries()]
        .some(([glyph, count]) => count > 0 && glyph !== character.glyph)
      return hasCandidate ? { ok: true } : { ok: false, error: 'NO_CHARACTER_CANDIDATE' as const }
    }
    if (target.kind === 'battlefield_point') {
      const definition = player.itemSnapshot?.activeItems.find((entry) => entry.itemId === itemId)
      const radius = definition?.targeting.radiusMilliCells ?? 0
      const hasLegalTarget = this.enemies.some((enemy) => enemy.lifecycle === 'alive' && this.isEnemyTargetable(enemy)
        && this.distanceSquared(target.xMilli, target.yMilli, enemy.xMilli, enemy.yMilli) <= radius ** 2)
      return hasLegalTarget ? { ok: true, hasLegalTarget } : { ok: false, error: 'INVALID_ITEM_TARGET' as const, hasLegalTarget }
    }
    if (target.kind === 'discarded_character_to_empty_slot') {
      const token = player.discardedCharacters.find((entry) => entry.id === target.tokenId)
      if (!token || token.createdSequence !== target.expectedTokenRevision) return { ok: false, error: 'TARGET_REVISION_MISMATCH' as const }
      const destination = target.destination
      const storage = destination.zone === 'summon_tray' ? player.tray : player.reserve
      const revision = destination.zone === 'summon_tray' ? player.trayRevision : player.reserveRevision
      if (revision !== destination.expectedRevision) return { ok: false, error: 'TARGET_REVISION_MISMATCH' as const }
      if (!Number.isInteger(destination.index) || destination.index < 0 || destination.index >= storage.length || storage[destination.index]) {
        return { ok: false, error: 'NO_EMPTY_DESTINATION' as const }
      }
      return { ok: true }
    }
    return { ok: false, error: 'INVALID_ITEM_TARGET' as const }
  }

  private executeActiveItemPlan(
    player: PlayerRuntime,
    target: ActiveItemTarget,
    actions: readonly import('../item-v1').RegisteredRuleAction[],
    effects: readonly import('../item-v1').StructuredItemEffect[],
    sourceKey: string,
  ): void {
    for (const action of actions) {
      if (action.type === 'replace_character_token' && target.kind === 'piece') {
        const located = this.locateOwnedPiece(player, target.pieceId)
        if (!located || located.piece.kind !== 'character') continue
        const character = located.piece
        const candidates = [...player.remainingCharacterTokens.entries()]
          .filter(([glyph, count]) => count > 0 && glyph !== character.glyph)
          .map(([glyph]) => glyph).sort()
        const glyph = candidates[this.prng.pickIndex(candidates.length)]!
        const replacement = this.createCharacterPiece(player.playerId, glyph)
        this.consumeCharacterToken(player, glyph)
        player.discardedCharacters.push(character)
        located.replace(replacement)
        this.emit('CHARACTER_DISCARDED', { playerId: player.playerId, pieceId: character.id, glyph: character.glyph })
        if (located.zone === 'board') {
          player.boardRevision += 1
          this.reconcileGeneralFormations(player)
        } else if (located.zone === 'tray') player.trayRevision += 1
        else player.reserveRevision += 1
      }
      else if ((action.type === 'grant_general_experience' || action.type === 'grant_general_level') && target.kind === 'general') {
        const previous = this.generalFormations.getProgress(player.playerId, target.generalId)
        const definition = this.getGeneralDefinition(target.generalId)
        if (!previous || !definition) continue
        const requestedPoints = action.type === 'grant_general_experience'
          ? action.experiencePoints
          : Math.max(0, cumulativeExperienceRequiredForLevel(definition,
              Math.min(previous.maxLevel, previous.level + 1) as 2 | 3 | 4 | 5) - previous.experiencePoints)
        const capExperience = cumulativeExperienceRequiredForLevel(definition, previous.maxLevel)
        const points = Math.max(0, Math.min(requestedPoints, capExperience - previous.experiencePoints))
        const next = this.generalFormations.addExperience(player.playerId, target.generalId, points)
        if (next) this.emit('GENERAL_XP_GRANTED', { playerId: player.playerId, enemyId: null,
          generalId: target.generalId, xpPoints: points, experiencePoints: next.experiencePoints })
      }
      else if (action.type === 'refresh_summon_tray') {
        this.discardStorageCharacters(player, player.tray)
        player.tray = Array.from({ length: TRAY_SIZE }, () => this.drawRecruitPiece(player))
        player.trayRevision += 1
      }
      else if (action.type === 'recover_discarded_character' && target.kind === 'discarded_character_to_empty_slot') {
        const index = player.discardedCharacters.findIndex((entry) => entry.id === target.tokenId)
        if (index < 0) continue
        const [token] = player.discardedCharacters.splice(index, 1)
        if (target.destination.zone === 'summon_tray') {
          player.tray[target.destination.index] = token
          player.trayRevision += 1
        } else {
          player.reserve[target.destination.index] = token
          player.reserveRevision += 1
        }
      }
    }
    for (const effect of effects) {
      if (effect.type === 'current_health_true_damage' && target.kind === 'battlefield_point') {
        for (const enemy of this.enemies) {
          if (enemy.lifecycle !== 'alive' || !this.isEnemyTargetable(enemy)
            || this.distanceSquared(target.xMilli, target.yMilli, enemy.xMilli, enemy.yMilli) > effect.radiusMilliCells ** 2) continue
          const ratio = this.enemyTags(enemy).includes('boss') ? effect.bossCurrentHpRatioBps : effect.normalCurrentHpRatioBps
          const hpBefore = enemy.currentHp
          const requestedDamage = Math.floor(enemy.currentHp * ratio / 10000)
          const resolvedDamage = Math.floor(requestedDamage * this.bossDamageTakenRatioBps(enemy) / 10000)
          enemy.currentHp = Math.max(effect.minimumRemainingHp, enemy.currentHp - resolvedDamage)
          this.emit('DAMAGE_APPLIED', { enemyId: enemy.id, playerId: player.playerId, generalId: 'active_item',
            effectId: effect.effectId, damage: hpBefore - enemy.currentHp, hpBefore, hpAfter: enemy.currentHp,
            damageType: 'true', actionKind: 'active_item', isCritical: false, isSecondary: false })
        }
      }
      else if (effect.type === 'status_apply' && target.kind === 'battlefield_point') {
        for (const enemy of this.enemies) {
          if (enemy.lifecycle !== 'alive' || !this.isEnemyTargetable(enemy)
            || this.distanceSquared(target.xMilli, target.yMilli, enemy.xMilli, enemy.yMilli) > effect.radiusMilliCells ** 2) continue
          this.effectSequence += 1
          const baseDurationMs = this.enemyTags(enemy).includes('boss') ? effect.bossBaseDurationMs : effect.normalDurationMs
          const durationMs = CONTROL_STATUS_IDS.has(effect.statusId)
            ? this.settleEnemyControlDurationMs(enemy, baseDurationMs)
            : baseDurationMs
          this.statuses.push({ instanceId: `status-${this.effectSequence}`, enemyId: enemy.id,
            sourceGeneralId: 'active_item', ownerPlayerId: player.playerId, statusId: effect.statusId,
            stackGroup: `${sourceKey}:${effect.statusId}`, magnitude: effect.magnitudeBps, stacks: 1,
            appliedAtTick: this.currentTick, expiresAtTick: this.currentTick + Math.max(1, Math.ceil(durationMs / this.tickRateMs)) })
        }
      }
      else if (effect.type === 'timed_stat_modifier' && target.kind === 'general') {
        const formation = this.generalFormations.getActiveFormations(player.playerId)
          .find((entry) => entry.generalId === target.generalId)
        if (!formation) continue
        this.effectSequence += 1
        this.generalStatuses.push({ instanceId: `general-status-${this.effectSequence}`, ownerPlayerId: player.playerId,
          sourceGeneralId: target.generalId, sourceFormationId: formation.formationId,
          statusId: `active_item_${effect.stat}`, stackGroup: effect.stackGroup, magnitude: effect.valueBps, stacks: 1,
          appliedAtTick: this.currentTick, expiresAtTick: this.currentTick + Math.max(1, Math.ceil(effect.durationMs / this.tickRateMs)) })
      }
    }
  }

  private consumeCharacterToken(player: PlayerRuntime, glyph: string): void {
    const count = player.remainingCharacterTokens.get(glyph) ?? 0
    if (count <= 1) player.remainingCharacterTokens.delete(glyph)
    else player.remainingCharacterTokens.set(glyph, count - 1)
  }

  private locateOwnedPiece(player: PlayerRuntime, pieceId: string): {
    piece: PvePiece
    zone: 'tray' | 'reserve' | 'board'
    revision: number
    replace: (piece: PvePiece) => void
  } | null {
    const trayIndex = player.tray.findIndex((piece) => piece?.id === pieceId)
    if (trayIndex >= 0) return { piece: player.tray[trayIndex]!, zone: 'tray', revision: player.trayRevision,
      replace: (piece) => { player.tray[trayIndex] = piece } }
    const reserveIndex = player.reserve.findIndex((piece) => piece?.id === pieceId)
    if (reserveIndex >= 0) return { piece: player.reserve[reserveIndex]!, zone: 'reserve', revision: player.reserveRevision,
      replace: (piece) => { player.reserve[reserveIndex] = piece } }
    for (const [key, entry] of player.board.entries()) {
      if (entry.piece.id === pieceId) return { piece: entry.piece, zone: 'board', revision: player.boardRevision,
        replace: (piece) => { player.board.set(key, { ...entry, piece }) } }
    }
    return null
  }

  private handleSwapTrayBoard(player: PlayerRuntime, action: SwapTrayBoardAction): PveRuntimeResult {
    const revisionError = this.validateRevisions(player, action.expectedTrayRevision, action.expectedBoardRevision)
    if (revisionError) {
      return this.actionResult(action, false, revisionError)
    }
    if (!Number.isInteger(action.trayIndex) || action.trayIndex < 0 || action.trayIndex >= TRAY_SIZE) {
      return this.actionResult(action, false, 'INVALID_TRAY_INDEX')
    }
    if (!this.canDeployAt(player.slot, action.boardX, action.boardY)) {
      return this.actionResult(action, false, 'CELL_NOT_DEPLOYABLE')
    }

    const key = boardKey(action.boardX, action.boardY)
    const trayPiece = player.tray[action.trayIndex]
    const boardEntry = player.board.get(key)
    const boardPiece = boardEntry?.piece ?? null
    if (!trayPiece && !boardPiece) {
      return this.actionResult(action, false, 'EMPTY_TO_EMPTY')
    }

    if (boardPiece && this.isPieceInFixedFormation(player.playerId, boardPiece.id)) {
      return this.actionResult(action, false, 'GENERAL_FIXED')
    }

    const previousBoard = this.cloneBoard(player.board)
    player.tray[action.trayIndex] = boardPiece
    if (trayPiece) {
      if (isSoldier(trayPiece)) {
        trayPiece.nextAttackTick = this.currentTick + this.attackIntervalTicks(trayPiece)
      }
      player.board.set(key, { x: action.boardX, y: action.boardY, piece: trayPiece })
    }
    else {
      player.board.delete(key)
    }
    const formationResult = this.reconcileGeneralFormations(player)
    if (!formationResult.ok) {
      player.board = previousBoard
      player.tray[action.trayIndex] = trayPiece
      return this.actionResult(action, false, formationResult.code)
    }
    player.trayRevision += 1
    player.boardRevision += 1
    this.emit('TRAY_BOARD_SWAPPED', {
      playerId: player.playerId,
      trayIndex: action.trayIndex,
      boardX: action.boardX,
      boardY: action.boardY,
      trayPieceId: trayPiece?.id ?? null,
      boardPieceId: boardPiece?.id ?? null,
    })
    return this.actionResult(action, true, 'TRAY_BOARD_SWAPPED')
  }

  private handleSwapReserveBoard(player: PlayerRuntime, action: SwapReserveBoardAction): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedReserveRevision, player.reserveRevision)) {
      return this.actionResult(action, false, 'STALE_RESERVE_REVISION')
    }
    if (!this.revisionMatches(action.expectedBoardRevision, player.boardRevision)) {
      return this.actionResult(action, false, 'STALE_BOARD_REVISION')
    }
    if (!Number.isInteger(action.reserveIndex) || action.reserveIndex < 0 || action.reserveIndex >= player.reserve.length) {
      return this.actionResult(action, false, 'INVALID_RESERVE_INDEX')
    }
    if (!this.canDeployAt(player.slot, action.boardX, action.boardY)) {
      return this.actionResult(action, false, 'CELL_NOT_DEPLOYABLE')
    }

    const key = boardKey(action.boardX, action.boardY)
    const reservePiece = player.reserve[action.reserveIndex]
    const boardEntry = player.board.get(key)
    const boardPiece = boardEntry?.piece ?? null
    if (!reservePiece && !boardPiece) {
      return this.actionResult(action, false, 'EMPTY_TO_EMPTY')
    }

    if (boardPiece && this.isPieceInFixedFormation(player.playerId, boardPiece.id)) {
      return this.actionResult(action, false, 'GENERAL_FIXED')
    }

    const previousBoard = this.cloneBoard(player.board)
    player.reserve[action.reserveIndex] = boardPiece
    if (reservePiece) {
      this.resetAttackCooldown(reservePiece)
      player.board.set(key, { x: action.boardX, y: action.boardY, piece: reservePiece })
    }
    else {
      player.board.delete(key)
    }
    const formationResult = this.reconcileGeneralFormations(player)
    if (!formationResult.ok) {
      player.board = previousBoard
      player.reserve[action.reserveIndex] = reservePiece
      return this.actionResult(action, false, formationResult.code)
    }
    player.reserveRevision += 1
    player.boardRevision += 1
    this.emit('RESERVE_BOARD_SWAPPED', {
      playerId: player.playerId,
      reserveIndex: action.reserveIndex,
      boardX: action.boardX,
      boardY: action.boardY,
      reservePieceId: reservePiece?.id ?? null,
      boardPieceId: boardPiece?.id ?? null,
    })
    return this.actionResult(action, true, 'RESERVE_BOARD_SWAPPED')
  }

  private handleExileReserve(player: PlayerRuntime, action: ExileReserveAction): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedReserveRevision, player.reserveRevision)) {
      return this.actionResult(action, false, 'STALE_RESERVE_REVISION')
    }
    const exiledPieceIds = player.reserve.flatMap((piece) => piece ? [piece.id] : [])
    this.discardStorageCharacters(player, player.reserve)
    player.reserve = Array<PvePiece | null>(player.reserve.length).fill(null)
    player.reserveRevision += 1
    this.emit('RESERVE_EXILED', {
      playerId: player.playerId,
      exiledPieceIds,
      exiledCount: exiledPieceIds.length,
    })
    return this.actionResult(action, true, 'RESERVE_EXILED', { exiledCount: exiledPieceIds.length })
  }

  private handleSwapStoragePieces(player: PlayerRuntime, action: SwapStoragePiecesAction): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedTrayRevision, player.trayRevision)) {
      return this.actionResult(action, false, 'STALE_TRAY_REVISION')
    }
    if (!this.revisionMatches(action.expectedReserveRevision, player.reserveRevision)) {
      return this.actionResult(action, false, 'STALE_RESERVE_REVISION')
    }
    if (!this.isStorageIndexValid(action.sourceZone, action.sourceIndex, player)
      || !this.isStorageIndexValid(action.targetZone, action.targetIndex, player)) {
      return this.actionResult(action, false, 'INVALID_STORAGE_INDEX')
    }
    if (action.sourceZone === action.targetZone && action.sourceIndex === action.targetIndex) {
      return this.actionResult(action, false, 'SAME_LOCATION')
    }

    const sourceStorage = action.sourceZone === 'tray' ? player.tray : player.reserve
    const targetStorage = action.targetZone === 'tray' ? player.tray : player.reserve
    const sourcePiece = sourceStorage[action.sourceIndex]
    const targetPiece = targetStorage[action.targetIndex]
    if (!sourcePiece && !targetPiece) {
      return this.actionResult(action, false, 'EMPTY_TO_EMPTY')
    }

    sourceStorage[action.sourceIndex] = targetPiece
    targetStorage[action.targetIndex] = sourcePiece
    if (action.sourceZone === 'tray' || action.targetZone === 'tray') {
      player.trayRevision += 1
    }
    if (action.sourceZone === 'reserve' || action.targetZone === 'reserve') {
      player.reserveRevision += 1
    }
    this.emit('STORAGE_PIECES_SWAPPED', {
      playerId: player.playerId,
      sourceZone: action.sourceZone,
      sourceIndex: action.sourceIndex,
      targetZone: action.targetZone,
      targetIndex: action.targetIndex,
      sourcePieceId: sourcePiece?.id ?? null,
      targetPieceId: targetPiece?.id ?? null,
    })
    return this.actionResult(action, true, 'STORAGE_PIECES_SWAPPED')
  }

  private handleSetGeneralFixed(player: PlayerRuntime, action: SetGeneralFixedAction): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedBoardRevision, player.boardRevision)) {
      return this.actionResult(action, false, 'STALE_BOARD_REVISION')
    }
    const current = this.generalFormations.getFormation(action.formationId)
    if (!current || current.ownerPlayerId !== player.playerId) {
      return this.actionResult(action, false, 'FORMATION_NOT_FOUND')
    }
    if (current.fixed === action.fixed) {
      return this.actionResult(action, true, 'GENERAL_FIXED_UNCHANGED', { fixed: action.fixed })
    }
    const next = this.generalFormations.setFixed(player.playerId, action.formationId, action.fixed)
    if (!next) {
      return this.actionResult(action, false, 'FORMATION_NOT_FOUND')
    }
    player.boardRevision += 1
    this.emit('GENERAL_FIXED_CHANGED', {
      playerId: player.playerId,
      generalId: next.generalId,
      formationId: next.formationId,
      fixed: next.fixed,
    })
    return this.actionResult(action, true, 'GENERAL_FIXED_CHANGED', { fixed: next.fixed })
  }

  private handleMoveFixedGeneral(player: PlayerRuntime, action: MoveFixedGeneralAction): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedBoardRevision, player.boardRevision)) {
      return this.actionResult(action, false, 'STALE_BOARD_REVISION')
    }
    if (!Number.isInteger(action.targetStartX) || !Number.isInteger(action.targetStartY)) {
      return this.actionResult(action, false, 'INVALID_TARGET')
    }
    const plan = this.generalFormations.planFixedFormationMove(
      player.playerId,
      action.formationId,
      { x: action.targetStartX, y: action.targetStartY },
      (x, y) => this.canDeployAt(player.slot, x, y),
      (x, y) => player.board.has(boardKey(x, y)),
    )
    if (!plan.ok) {
      return this.actionResult(action, false, plan.code)
    }

    const movedEntries = plan.tokenMoves.map((move) => {
      const entry = player.board.get(boardKey(move.from.x, move.from.y))
      return entry && entry.piece.id === move.tokenId ? { move, piece: entry.piece } : null
    })
    if (movedEntries.some((entry) => entry === null)) {
      return this.actionResult(action, false, 'FORMATION_PIECE_MISSING')
    }
    for (const entry of movedEntries) {
      if (entry) player.board.delete(boardKey(entry.move.from.x, entry.move.from.y))
    }
    for (const entry of movedEntries) {
      if (!entry) continue
      player.board.set(boardKey(entry.move.to.x, entry.move.to.y), {
        x: entry.move.to.x,
        y: entry.move.to.y,
        piece: entry.piece,
      })
    }
    const formationResult = this.reconcileGeneralFormations(player)
    if (!formationResult.ok) {
      throw new Error(`Fixed general move produced invalid formation state: ${formationResult.code}`)
    }
    player.boardRevision += 1
    this.emit('FIXED_GENERAL_MOVED', {
      playerId: player.playerId,
      formationId: action.formationId,
      targetStartX: action.targetStartX,
      targetStartY: action.targetStartY,
      pieceIds: movedEntries.flatMap((entry) => entry ? [entry.piece.id] : []),
    })
    return this.actionResult(action, true, 'FIXED_GENERAL_MOVED')
  }

  private handleMoveBoardPiece(player: PlayerRuntime, action: MoveBoardPieceAction): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedBoardRevision, player.boardRevision)) {
      return this.actionResult(action, false, 'STALE_BOARD_REVISION')
    }
    if (!this.canDeployAt(player.slot, action.targetX, action.targetY)) {
      return this.actionResult(action, false, 'CELL_NOT_DEPLOYABLE')
    }
    const source = this.findBoardEntryByPieceId(player, action.pieceId)
    if (!source) {
      return this.actionResult(action, false, 'PIECE_NOT_FOUND')
    }
    const sourceKey = boardKey(source.x, source.y)
    const targetKey = boardKey(action.targetX, action.targetY)
    if (sourceKey === targetKey) {
      return this.actionResult(action, false, 'SAME_LOCATION')
    }

    const target = player.board.get(targetKey)
    if (
      this.isPieceInFixedFormation(player.playerId, source.piece.id)
      || (target && this.isPieceInFixedFormation(player.playerId, target.piece.id))
    ) {
      return this.actionResult(action, false, 'GENERAL_FIXED')
    }
    const previousBoard = this.cloneBoard(player.board)
    player.board.set(targetKey, { x: action.targetX, y: action.targetY, piece: source.piece })
    if (target) {
      player.board.set(sourceKey, { x: source.x, y: source.y, piece: target.piece })
    }
    else {
      player.board.delete(sourceKey)
    }
    const formationResult = this.reconcileGeneralFormations(player)
    if (!formationResult.ok) {
      player.board = previousBoard
      return this.actionResult(action, false, formationResult.code)
    }
    this.resetAttackCooldown(source.piece)
    if (target) {
      this.resetAttackCooldown(target.piece)
    }
    player.boardRevision += 1
    this.emit('BOARD_PIECE_MOVED', {
      playerId: player.playerId,
      pieceId: action.pieceId,
      sourceX: source.x,
      sourceY: source.y,
      targetX: action.targetX,
      targetY: action.targetY,
      swappedPieceId: target?.piece.id ?? null,
    })
    return this.actionResult(action, true, 'BOARD_PIECE_MOVED')
  }

  private handleMergeSoldiers(player: PlayerRuntime, action: MergeSoldiersAction): PveRuntimeResult {
    const revisionError = this.validateRevisions(
      player,
      action.expectedTrayRevision,
      action.expectedBoardRevision,
      action.expectedReserveRevision,
    )
    if (revisionError) {
      return this.actionResult(action, false, revisionError)
    }
    if (action.sourcePieceId === action.targetPieceId) {
      return this.actionResult(action, false, 'SAME_PIECE')
    }

    const source = this.findPiece(player, action.sourcePieceId)
    const target = this.findPiece(player, action.targetPieceId)
    if (!source || !target) {
      return this.actionResult(action, false, 'PIECE_NOT_FOUND')
    }
    if (!isSoldier(source.piece) || !isSoldier(target.piece)) {
      return this.actionResult(action, false, 'NOT_SOLDIER')
    }
    if (source.piece.soldierType !== target.piece.soldierType) {
      return this.actionResult(action, false, 'TYPE_MISMATCH')
    }
    if (source.piece.level !== target.piece.level) {
      return this.actionResult(action, false, 'LEVEL_MISMATCH')
    }
    if (source.piece.level >= 5) {
      return this.actionResult(action, false, 'MAX_LEVEL')
    }

    const nextLevel = (source.piece.level + 1) as SoldierLevel
    const merged = this.createSoldierPiece(player.playerId, source.piece.soldierType, nextLevel, 0)
    this.removePieceAt(player, source.location)
    this.removePieceAt(player, target.location)
    this.putPieceAt(player, target.location, merged)
    if (target.location.kind === 'board') {
      merged.nextAttackTick = this.currentTick + this.attackIntervalTicks(merged)
    }

    if (source.location.kind === 'tray' || target.location.kind === 'tray') {
      player.trayRevision += 1
    }
    if (source.location.kind === 'board' || target.location.kind === 'board') {
      player.boardRevision += 1
    }
    if (source.location.kind === 'reserve' || target.location.kind === 'reserve') {
      player.reserveRevision += 1
    }
    this.emit('SOLDIER_MERGED', {
      playerId: player.playerId,
      sourcePieceId: action.sourcePieceId,
      targetPieceId: action.targetPieceId,
      mergedPieceId: merged.id,
      soldierType: merged.soldierType,
      level: merged.level,
      targetLocation: target.location.kind,
    })
    return this.actionResult(action, true, 'SOLDIER_MERGED', {
      mergedPieceId: merged.id,
      level: merged.level,
    })
  }

  private drawRecruitPiece(player: PlayerRuntime, forceCharacter = false): PvePiece {
    const eligibleGlyphs = [...player.remainingCharacterTokens.entries()]
      .filter(([, count]) => count > 0)
      .map(([glyph]) => glyph)
      .sort((left, right) => left.localeCompare(right))

    const characterProbabilityBps = player.passiveItems?.characterProbabilityBps ?? CHARACTER_BRANCH_BPS
    if (eligibleGlyphs.length > 0 && (forceCharacter || this.prng.rollBps(characterProbabilityBps))) {
      const glyph = eligibleGlyphs[this.prng.pickIndex(eligibleGlyphs.length)]
      const nextCount = (player.remainingCharacterTokens.get(glyph) ?? 0) - 1
      if (nextCount > 0) {
        player.remainingCharacterTokens.set(glyph, nextCount)
      }
      else {
        player.remainingCharacterTokens.delete(glyph)
      }
      return this.createCharacterPiece(player.playerId, glyph)
    }
    return this.createSoldierPiece(player.playerId, this.drawSoldierType(), 1, 0)
  }

  private drawSoldierType() {
    return SOLDIER_TYPES[this.prng.pickIndex(SOLDIER_TYPES.length)]
  }

  private createSoldierPiece(
    ownerPlayerId: string,
    soldierType: SoldierPiece['soldierType'],
    level: SoldierLevel,
    nextAttackTick: number,
  ): SoldierPiece {
    this.pieceSequence += 1
    return {
      id: `piece-${this.pieceSequence}`,
      kind: 'soldier',
      ownerPlayerId,
      soldierType,
      level,
      nextAttackTick,
      createdSequence: this.pieceSequence,
    }
  }

  private createCharacterPiece(ownerPlayerId: string, glyph: string): CharacterPiece {
    this.pieceSequence += 1
    return {
      id: `piece-${this.pieceSequence}`,
      kind: 'character',
      ownerPlayerId,
      glyph,
      createdSequence: this.pieceSequence,
    }
  }

  private prepareWave(waveNumber: number): void {
    if (this.currentWaveNumber === 0) {
      this.currentWaveNumber = waveNumber
    }
    else {
      this.pendingWaveNumber = waveNumber
    }
    this.wavePhase = 'prep'
    this.prepRemainingTicks = this.currentWaveNumber === waveNumber && this.currentWaveNumber === this.initialWaveNumber
      ? this.tutorialPrepDurationTicks
      : this.prepDurationTicks
  }

  private beginPreparedWave(): void {
    if (this.pendingWaveNumber !== null) {
      this.currentWaveNumber = this.pendingWaveNumber
      this.pendingWaveNumber = null
    }
    this.beginWaveSpawning()
  }

  private beginWaveSpawning(): void {
    const definition = this.getWaveDefinition(this.currentWaveNumber)
    if (!definition || this.currentWaveNumber > this.maxWaves) {
      this.finishMatch('victory', 'All configured waves cleared')
      return
    }
    const activePlayers = [...this.players.values()].sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot))
    if (activePlayers.length === 0) {
      this.finishMatch('defeat', 'No active players')
      return
    }

    this.wavePhase = 'spawning'
    const nextLaneWaves = activePlayers.map((player) => ({
      waveNumber: this.currentWaveNumber,
      playerId: player.playerId,
      slot: player.slot,
      spawnedCount: 0,
      totalCount: definition.countPerPlayer,
      nextSpawnTick: this.currentTick,
      lastSpawnedEnemyId: null,
      bossEncounter: resolveBossEncounter(
        this.balanceProfile.levelId,
        this.balanceProfile.difficulty,
        this.currentWaveNumber,
      ),
      bossSpawned: false,
      bossEnemyId: null,
      clearRewardGranted: false,
      retired: false,
    }))
    this.laneWaves.push(...nextLaneWaves)
    this.emit('WAVE_STARTED', {
      waveNumber: this.currentWaveNumber,
      laneCount: nextLaneWaves.length,
      countPerLane: definition.countPerPlayer,
      bossPerLane: nextLaneWaves[0]?.bossEncounter ? 1 : 0,
    })
  }

  private spawnDueEnemies(): void {
    if (this.wavePhase !== 'spawning') {
      return
    }
    const definition = this.getWaveDefinition(this.currentWaveNumber)
    if (!definition) {
      return
    }
    const intervalTicks = Math.max(1, Math.ceil(
      resolvePveLaneSpawnIntervalMs(definition.spawnIntervalMs) / this.tickRateMs,
    ))

    const currentLanes = this.currentLaneWaves()
    for (const lane of currentLanes) {
      if (
        nextLaneSpawnEntityKind({
          ordinarySpawnedCount: lane.spawnedCount,
          ordinaryTotalCount: lane.totalCount,
          bossRequired: lane.bossEncounter !== null,
          bossSpawned: lane.bossSpawned,
        }) === null
        || this.currentTick < lane.nextSpawnTick
        || !this.hasPreviousSpawnFullyExited(lane)
      ) continue

      const spawnBoss = nextLaneSpawnEntityKind({
        ordinarySpawnedCount: lane.spawnedCount,
        ordinaryTotalCount: lane.totalCount,
        bossRequired: lane.bossEncounter !== null,
        bossSpawned: lane.bossSpawned,
      }) === 'boss'
      const enemy = spawnBoss
        ? this.spawnBoss(lane, lane.bossEncounter!)
        : this.spawnEnemy(lane, definition)
      if (spawnBoss) {
        lane.bossSpawned = true
        lane.bossEnemyId = enemy.id
      }
      else lane.spawnedCount += 1
      lane.lastSpawnedEnemyId = enemy.id
      // 以实际生成 Tick 为基准，禁止因历史积压在同一 Tick 连续补刷多个单位。
      // 下一只还必须同时通过 hasPreviousSpawnFullyExited 空间门：
      // “最小时间间隔”和“上一只完整离开出生方格”缺一不可。
      lane.nextSpawnTick = this.currentTick + intervalTicks
    }
  }

  private hasPreviousSpawnFullyExited(lane: LaneWaveRuntime): boolean {
    if (!lane.lastSpawnedEnemyId) return true
    const previous = this.enemies.find((enemy) => enemy.id === lane.lastSpawnedEnemyId)
    // 普通小怪在出生方格内不可死亡；找不到表示它已离场后死亡并被清理。
    return !previous || !previous.spawnProtected
  }

  private spawnEnemy(lane: LaneWaveRuntime, definition: WaveMinionCatalogEntry): EnemyRuntime {
    const route = this.laneRoutes[lane.slot]
    const spawn = route.waypoints[0]
    const glyph = definition.glyphPool[this.prng.pickIndex(definition.glyphPool.length)]
    this.enemySequence += 1
    const enemy: EnemyRuntime = {
      id: `enemy-${this.enemySequence}`,
      glyph,
      waveNumber: definition.waveNumber,
      laneOwnerPlayerId: lane.playerId,
      laneSlot: lane.slot,
      spawnSequence: this.enemySequence,
      xMilli: spawn.x * 1000,
      yMilli: spawn.y * 1000,
      routeWaypointIndex: 0,
      lapCount: 0,
      pathProgressMilli: 0,
      currentHp: definition.maxHp,
      maxHp: definition.maxHp,
      armor: definition.armor,
      magicResistance: definition.magicResistance,
      moveSpeedMilliCellsPerSecond: definition.moveSpeedMilliCellsPerSecond,
      lastDamagePlayerId: null,
      entityKind: 'ordinary_minion',
      bossDefinitionId: null,
      bossName: null,
      controlResistanceBps: 0,
      controlDurationCapMs: 0,
      bossPhase: 0,
      activeCast: null,
      // 这是空间入场锁，不是护盾或定时无敌；整个身体离开中央出生方格后解除。
      spawnProtected: true,
      invulnerable: false,
      lifecycle: 'alive',
      riceReward: definition.riceReward,
      experiencePoints: definition.xpRewardPoints,
      generalContributions: new Map(),
    }
    this.enemies.push(enemy)
    this.emit('ENEMY_SPAWNED', {
      enemyId: enemy.id,
      glyph,
      waveNumber: definition.waveNumber,
      laneOwnerPlayerId: lane.playerId,
      laneSlot: lane.slot,
    })
    return enemy
  }

  private spawnBoss(lane: LaneWaveRuntime, encounter: ResolvedBossEncounterV1): EnemyRuntime {
    const route = this.laneRoutes[lane.slot]
    const spawn = route.waypoints[0]
    this.enemySequence += 1
    const enemy: EnemyRuntime = {
      id: `enemy-${this.enemySequence}`,
      glyph: encounter.definition.glyph,
      waveNumber: encounter.waveNumber,
      laneOwnerPlayerId: lane.playerId,
      laneSlot: lane.slot,
      spawnSequence: this.enemySequence,
      xMilli: spawn.x * 1000,
      yMilli: spawn.y * 1000,
      routeWaypointIndex: 0,
      lapCount: 0,
      pathProgressMilli: 0,
      currentHp: encounter.stats.maxHp,
      maxHp: encounter.stats.maxHp,
      armor: encounter.stats.armor,
      magicResistance: encounter.stats.magicResistance,
      moveSpeedMilliCellsPerSecond: encounter.stats.moveSpeedMilliCellsPerSecond,
      lastDamagePlayerId: null,
      entityKind: 'boss',
      bossDefinitionId: encounter.definition.bossDefinitionId,
      bossName: encounter.definition.displayName,
      controlResistanceBps: encounter.stats.controlResistanceBps,
      controlDurationCapMs: encounter.stats.maxSingleControlDurationMs,
      bossPhase: 1,
      activeCast: null,
      spawnProtected: true,
      invulnerable: false,
      lifecycle: 'alive',
      riceReward: encounter.rewardProfile.rice,
      experiencePoints: encounter.rewardProfile.experienceMilli,
      generalContributions: new Map(),
    }
    this.enemies.push(enemy)
    this.bossRuntime.registerBoss(enemy, encounter, this.currentTick,
      (type, data, choreography) => this.emit(type, data, choreography))
    this.emit('ENEMY_SPAWNED', {
      enemyId: enemy.id,
      glyph: enemy.glyph,
      entityKind: enemy.entityKind,
      waveNumber: enemy.waveNumber,
      laneOwnerPlayerId: lane.playerId,
      laneSlot: lane.slot,
    })
    this.emit('BOSS_SPAWNED', {
      enemyId: enemy.id,
      bossDefinitionId: enemy.bossDefinitionId,
      bossName: enemy.bossName,
      waveNumber: enemy.waveNumber,
      laneOwnerPlayerId: lane.playerId,
      laneSlot: lane.slot,
    })
    return enemy
  }

  private moveEnemies(): void {
    const distancePerTick = Math.floor(1000 * this.tickRateMs / 1000)
    for (const enemy of this.enemies) {
      if (enemy.lifecycle !== 'alive') {
        continue
      }
      if (this.statusMagnitude(enemy.id, 'stun') <= 0
        && this.statusMagnitude(enemy.id, 'root') <= 0
        && this.statusMagnitude(enemy.id, 'suppress') <= 0) {
        const slow = settleEnemySlowBps(enemy.entityKind, this.statusMagnitude(enemy.id, 'slow'))
        const bossMovementRatio = this.bossRuntime.movementRatioBps(
          enemy,
          this.bossEnemyViews(),
          this.currentTick,
          (type, data, choreography) => this.emit(type, data, choreography),
        )
        this.moveEnemy(enemy, Math.floor(distancePerTick * (10000 - slow) / 10000 * bossMovementRatio / 10000))
      }
      if (
        enemy.spawnProtected
        && hasEnemyBodyFullyExitedPveSpawnSquareMilli(enemy.xMilli, enemy.yMilli)
      ) {
        enemy.spawnProtected = false
        this.emit('ENEMY_ENTERED_BATTLEFIELD', {
          enemyId: enemy.id,
          waveNumber: enemy.waveNumber,
          laneOwnerPlayerId: enemy.laneOwnerPlayerId,
          laneSlot: enemy.laneSlot,
          xMilli: enemy.xMilli,
          yMilli: enemy.yMilli,
        })
      }
    }
  }

  private advanceBossSkills(): void {
    this.bossRuntime.advance({
      tick: this.currentTick,
      enemies: this.bossEnemyViews(),
      emit: (type, data, choreography) => this.emit(type, data, choreography),
    })
    for (const enemy of this.enemies) {
      if (enemy.entityKind !== 'boss') continue
      const projection = this.bossRuntime.projectEnemy(enemy.id)
      if (projection) {
        enemy.bossPhase = projection.phase
        enemy.activeCast = projection.activeCast
      }
    }
  }

  private bossEnemyViews(): BossRuntimeEnemyView[] {
    return this.enemies.map((enemy) => enemy)
  }

  private bossDamageTakenRatioBps(enemy: EnemyRuntime): number {
    return this.bossRuntime.damageTakenRatioBps(
      enemy,
      this.bossEnemyViews(),
      this.currentTick,
      (type, data, choreography) => this.emit(type, data, choreography),
    )
  }

  private settleEnemyControlDurationMs(enemy: EnemyRuntime, requestedDurationMs: number): number {
    if (enemy.entityKind !== 'boss') return Math.max(0, requestedDurationMs)
    return settleBossControlDurationMs(
      requestedDurationMs,
      enemy.controlResistanceBps,
      enemy.controlDurationCapMs,
    )
  }

  private moveEnemy(enemy: EnemyRuntime, requestedDistance: number): void {
    const route = this.laneRoutes[enemy.laneSlot]
    let remaining = Math.floor(requestedDistance * enemy.moveSpeedMilliCellsPerSecond / 1000)
    let traversed = 0
    const traversalGuard = route.waypoints.length * 2 + 4

    while (remaining > 0 && traversed < traversalGuard) {
      traversed += 1
      let nextIndex = enemy.routeWaypointIndex + 1
      if (nextIndex >= route.waypoints.length) {
        nextIndex = route.loopStartIndex
        enemy.lapCount += 1
      }
      const target = route.waypoints[nextIndex]
      const targetX = target.x * 1000
      const targetY = target.y * 1000
      const deltaX = targetX - enemy.xMilli
      const deltaY = targetY - enemy.yMilli
      const distance = Math.abs(deltaX) + Math.abs(deltaY)

      if (distance === 0) {
        enemy.routeWaypointIndex = nextIndex
        continue
      }
      const travel = Math.min(remaining, distance)
      enemy.xMilli += Math.sign(deltaX) * Math.min(Math.abs(deltaX), travel)
      const consumedX = Math.min(Math.abs(deltaX), travel)
      const remainingForY = travel - consumedX
      enemy.yMilli += Math.sign(deltaY) * Math.min(Math.abs(deltaY), remainingForY)
      enemy.pathProgressMilli += travel
      remaining -= travel
      if (travel === distance) {
        enemy.routeWaypointIndex = nextIndex
      }
    }
  }

  /** 用绝对路径进度重建位置，位移效果不直接修改任意二维坐标。 */
  private setEnemyPathProgress(enemy: EnemyRuntime, requestedProgress: number): void {
    const route = this.laneRoutes[enemy.laneSlot]
    const progress = Math.max(0, Math.floor(requestedProgress))
    enemy.xMilli = route.waypoints[0].x * 1000
    enemy.yMilli = route.waypoints[0].y * 1000
    enemy.routeWaypointIndex = 0
    enemy.lapCount = 0
    enemy.pathProgressMilli = 0
    let remaining = progress
    let guard = 0
    const maxSegments = route.waypoints.length * 2 + Math.ceil(progress / 1000) + 8
    while (remaining > 0 && guard < maxSegments) {
      guard += 1
      let nextIndex = enemy.routeWaypointIndex + 1
      if (nextIndex >= route.waypoints.length) {
        nextIndex = route.loopStartIndex
        enemy.lapCount += 1
      }
      const target = route.waypoints[nextIndex]
      const targetX = target.x * 1000
      const targetY = target.y * 1000
      const dx = targetX - enemy.xMilli
      const dy = targetY - enemy.yMilli
      const distance = Math.abs(dx) + Math.abs(dy)
      if (distance === 0) { enemy.routeWaypointIndex = nextIndex; continue }
      const travel = Math.min(remaining, distance)
      const xTravel = Math.min(Math.abs(dx), travel)
      enemy.xMilli += Math.sign(dx) * xTravel
      enemy.yMilli += Math.sign(dy) * Math.min(Math.abs(dy), travel - xTravel)
      enemy.pathProgressMilli += travel
      remaining -= travel
      if (travel === distance) enemy.routeWaypointIndex = nextIndex
    }
  }

  private resolveGeneralAttacks(): void {
    const formations = [...this.players.values()]
      .flatMap((player) => this.generalFormations.getActiveFormations(player.playerId).map((formation) => ({
        player,
        formation,
      })))
      .sort((left, right) => slotOrder(left.player.slot) - slotOrder(right.player.slot)
        || left.formation.generalId.localeCompare(right.formation.generalId))

    for (const { player, formation } of formations) {
      const catalogDefinition = this.getGeneralDefinition(formation.generalId)
      const progress = this.generalFormations.getProgress(player.playerId, formation.generalId)
      if (!catalogDefinition || !progress) continue
      const definition = this.definitionWithSynergyCooldown(player.playerId, catalogDefinition)

      const combatPlan = planGeneralCombatFrame({
        definition,
        formation,
        progress,
        currentTick: this.currentTick,
        tickRateMs: this.tickRateMs,
        modifiers: this.generalSynergyModifiers(player.playerId, formation.generalId),
        parameterResolver: (effectId, parameter, baseValue) => this.resolvePlanningEffectParameter(
          player.playerId, formation.generalId, formation.formationId, effectId, parameter, baseValue,
        ),
        enemies: this.enemies.map((enemy) => ({
          id: enemy.id,
          xMilli: enemy.xMilli,
          yMilli: enemy.yMilli,
          currentHp: enemy.currentHp,
          pathProgressMilli: enemy.pathProgressMilli,
          spawnSequence: enemy.spawnSequence,
          targetable: enemy.lifecycle === 'alive' && this.isEnemyTargetable(enemy),
          tags: this.enemyTags(enemy),
        })),
      })
      this.generalFormations.replaceProgress(combatPlan.nextProgress)
      const targetsByActionId = new Map<string, string[]>()
      for (const action of combatPlan.combatActions) {
        const targets = targetsByActionId.get(action.actionId) ?? []
        for (const targetId of action.targetEnemyIds) if (!targets.includes(targetId)) targets.push(targetId)
        if (action.effectType === 'damage') {
          for (const target of this.selectHouyiWeaponExtensionTargets(player, action)) {
            if (!targets.includes(target.id)) targets.push(target.id)
          }
        }
        targetsByActionId.set(action.actionId, targets)
      }
      const emittedCasts = new Set<string>()
      for (const action of combatPlan.combatActions) {
        const actionId = `${formation.formationId}:${action.actionId}`
        const targetIds = targetsByActionId.get(action.actionId) ?? []
        const geometry = this.generalActionGeometry(player, formation, progress.level, definition, action, targetIds)
        if (!emittedCasts.has(action.actionId) && action.actionKind === 'active_skill') {
          this.emit('GENERAL_SKILL_CAST', {
            playerId: player.playerId,
            generalId: action.sourceGeneralId,
            formationId: action.sourceFormationId,
            skillId: definition.activeSkill.skillId,
            skillName: definition.activeSkill.skillName,
            targetEnemyId: action.primaryTargetEnemyId,
            targetIds,
            actionId,
          }, { actionId, targetIds, geometry })
        }
        else if (!emittedCasts.has(action.actionId) && action.actionKind === 'basic_attack') {
          this.emit('GENERAL_BASIC_ATTACK_STARTED', {
            playerId: player.playerId,
            generalId: action.sourceGeneralId,
            formationId: action.sourceFormationId,
            targetEnemyId: action.primaryTargetEnemyId,
            targetIds,
            actionId,
          }, { actionId, targetIds, geometry })
        }
        emittedCasts.add(action.actionId)
        this.executeGeneralCombatAction(player, formation, progress.level, action)
        this.executeWeaponCombatExtensions(player, formation, progress.level, action)
      }

      const trigger = definition.passiveSkill.trigger
      if (trigger?.kind === 'periodic') {
        this.executePassivePlan(player, formation, progress.level, 'initialize')
      }
      if (combatPlan.combatActions.some((action) => action.actionKind === 'basic_attack')) {
        this.executePassivePlan(player, formation, progress.level, 'basic_attack')
      }
      if (combatPlan.combatActions.some((action) => action.actionKind === 'active_skill' && action.targetEnemyIds.length > 0)) {
        this.executePassivePlan(player, formation, progress.level, 'skill_hit')
      }
    }
  }

  private applyGeneralDamage(
    player: PlayerRuntime,
    formation: GeneralFormationState,
    level: 1 | 2 | 3 | 4 | 5,
    action: GeneralDamageCombatAction,
    target: EnemyRuntime,
  ): void {
    const definition = this.getGeneralDefinition(action.sourceGeneralId)
    if (!definition || !this.isEnemyTargetable(target)) return
    const targetTags = this.enemyTags(target)
    const effectTags = [action.actionKind, 'damage', action.damage.damageType]
    let rawDamage = Math.max(1, Math.floor(
      (action.damage.baseAttack * action.damage.coefficientBps / 10000 + action.damage.flatDamage)
      * action.damage.damageDealtRatioBps / 10000,
    ))
    if (action.actionKind === 'basic_attack') {
      const empowered = this.consumeGeneralStatus(action.ownerPlayerId, action.sourceGeneralId,
        action.sourceFormationId, 'next_basic_attack_damage_up')
      if (empowered) {
        rawDamage = Math.max(1, Math.floor(rawDamage * (10000 + empowered.magnitude * empowered.stacks) / 10000))
      }
    }
    const bounceFalloff = Math.max(0, this.resolveCombinedEffectParameter(player.playerId,
      action.sourceGeneralId, action.sourceFormationId, action.effectId,
      'bounceDamageFalloffBps', action.bounceDamageFalloffBps))
    rawDamage = Math.max(1, Math.floor(rawDamage
      * Math.max(0, 10000 - action.targetIndex * bounceFalloff) / 10000))
    const synergyDamageRatio = this.settleGeneralSynergyStat({ playerId: player.playerId,
      generalId: action.sourceGeneralId, stat: 'damageDealt', baseValue: 10000, targetTags, effectTags })
    const typedDamageRatio = this.settleGeneralSynergyStat({ playerId: player.playerId,
      generalId: action.sourceGeneralId,
      stat: action.damage.damageType === 'physical' ? 'physicalDamageBonus' : 'magicDamageBonus',
      baseValue: 10000, targetTags, effectTags })
    rawDamage = Math.max(1, Math.floor(rawDamage * synergyDamageRatio / 10000 * typedDamageRatio / 10000))
    let weaponRatio = 10000
    if (action.damage.damageType === 'magic') weaponRatio = Math.floor(weaponRatio
      * this.weaponStatRatio(player.playerId, action.sourceGeneralId, 'magic_damage', targetTags) / 10000)
    if (action.actionKind === 'active_skill') weaponRatio = Math.floor(weaponRatio
      * this.weaponStatRatio(player.playerId, action.sourceGeneralId, 'direct_skill_damage', targetTags) / 10000)
    if (targetTags.includes('boss')) weaponRatio = Math.floor(weaponRatio
      * this.weaponStatRatio(player.playerId, action.sourceGeneralId, 'boss_damage', targetTags) / 10000)
    if (this.hasAnyControlStatus(target.id)) weaponRatio = Math.floor(weaponRatio
      * this.weaponStatRatio(player.playerId, action.sourceGeneralId, 'controlled_target_damage', ['controlled', ...targetTags]) / 10000)
    rawDamage = Math.max(1, Math.floor(rawDamage * weaponRatio / 10000))
    let passiveItemRatio = 10000
    if (action.damage.damageType === 'magic') passiveItemRatio += this.passiveCombatRatio(player, action.sourceGeneralId, 'magicDamage')
    if (action.actionKind === 'active_skill') passiveItemRatio += this.activeItemTimedRatio(player.playerId,
      action.sourceGeneralId, 'activeSkillDamage')
    rawDamage = Math.max(1, Math.floor(rawDamage * passiveItemRatio / 10000))
    const stats = resolveGeneralStats(
      definition,
      level,
      this.generalSynergyModifiers(player.playerId, action.sourceGeneralId, targetTags, effectTags),
      targetTags,
    )
    const isCritical = action.damage.criticalPolicy === 'can_crit' && this.prng.rollBps(stats.critChanceBps)
    if (isCritical) rawDamage = Math.floor(rawDamage * stats.critDamageBps / 10000)
    const armorBreak = this.statusMagnitude(target.id, 'armor_break')
    const physicalDefense = Math.max(0, Math.floor(target.armor * Math.max(0, 10000 - armorBreak) / 10000))
    const defense = action.damage.damageType === 'physical' ? physicalDefense : target.magicResistance
    const finalDamage = Math.max(1, Math.floor(rawDamage * 100 / (100 + Math.max(0, defense))))
    const vulnerable = this.damageVulnerabilityMagnitude(target.id, action.actionKind, action.damage.damageType)
    const resolvedDamage = Math.max(1, Math.floor(finalDamage * (10000 + vulnerable) / 10000
      * this.bossDamageTakenRatioBps(target) / 10000))
    const hpBefore = target.currentHp
    target.currentHp = Math.max(0, target.currentHp - resolvedDamage)
    target.lastDamagePlayerId = player.playerId
    this.recordGeneralContribution(target, player.playerId, action.sourceGeneralId,
      action.damage.damageType === 'physical' ? 'physical' : 'magic')
    this.emit('DAMAGE_APPLIED', {
      attackerId: formation.formationId,
      playerId: player.playerId,
      generalId: action.sourceGeneralId,
      sourceKind: action.actionKind,
      effectId: action.damage.effectId,
      enemyId: target.id,
      rawDamage,
      finalDamage: resolvedDamage,
      hpBefore,
      hpAfter: target.currentHp,
      isCritical,
      isSecondary: false,
      actionId: `${formation.formationId}:${action.actionId}`,
    }, {
      actionId: `${formation.formationId}:${action.actionId}`,
      targetIds: [target.id],
      geometry: { kind: 'point', xMilli: target.xMilli, yMilli: target.yMilli },
    })
    if (target.currentHp <= 0) this.settleEnemyDeath(target)
  }

  private executeGeneralCombatAction(
    player: PlayerRuntime,
    formation: GeneralFormationState,
    level: 1 | 2 | 3 | 4 | 5,
    action: GeneralCombatAction,
  ): void {
    if (action.effectType === 'damage') {
      const target = this.enemies.find((enemy) => enemy.id === action.targetEnemyId)
      if (!target || target.lifecycle !== 'alive' || !this.isEnemyTargetable(target)) return
      if (action.delayMs > 0) {
        this.pendingCombatActions.push({
          dueTick: this.currentTick + Math.ceil(action.delayMs / this.tickRateMs),
          playerId: player.playerId,
          formation: structuredClone(formation),
          level,
          action: { ...action, delayMs: 0 },
        })
        return
      }
      this.applyGeneralDamage(player, formation, level, this.withPatchedDamage(action), target)
    }
    else if (action.effectType === 'damage_over_time') {
      const definition = this.getGeneralDefinition(action.sourceGeneralId)
      const stats = definition ? resolveGeneralStats(definition, level, this.generalSynergyModifiers(player.playerId, action.sourceGeneralId)) : null
      for (const enemyId of action.targetEnemyIds) {
        const target = this.enemies.find((enemy) => enemy.id === enemyId)
        if (!target || target.lifecycle !== 'alive' || !this.isEnemyTargetable(target)) continue
        this.effectSequence += 1
        const existing = this.damageOverTime.find((entry) => entry.enemyId === enemyId
          && entry.ownerPlayerId === player.playerId && entry.stackGroup === action.stacking.stackGroup)
        const next: DamageOverTimeRuntime = {
          instanceId: `dot-${this.effectSequence}`,
          enemyId,
          ownerPlayerId: player.playerId,
          sourceGeneralId: action.sourceGeneralId,
          sourceFormationId: action.sourceFormationId,
          damageType: action.damageType,
          baseAttack: stats?.attack ?? 1,
          coefficientBpsPerTick: this.patchedNumber(action, 'coefficientBpsPerTick', action.coefficientBpsPerTick),
          flatDamagePerTick: this.patchedNumber(action, 'flatDamagePerTick', action.flatDamagePerTick),
          nextTick: this.currentTick + Math.max(1, Math.ceil(action.tickIntervalMs / this.tickRateMs)),
          tickIntervalTicks: Math.max(1, Math.ceil(action.tickIntervalMs / this.tickRateMs)),
          expiresAtTick: this.currentTick + Math.max(1, Math.ceil(action.durationMs
            * this.weaponStatRatio(player.playerId, action.sourceGeneralId, 'dot_duration') / 10000 / this.tickRateMs)),
          stackGroup: action.stacking.stackGroup,
        }
        if (existing && action.stacking.policy !== 'independent' && action.stacking.policy !== 'stack') {
          Object.assign(existing, next, { instanceId: existing.instanceId })
        }
        else this.damageOverTime.push(next)
        this.emit('GENERAL_EFFECT_APPLIED', { effectType: action.effectType, effectId: action.effectId, enemyId })
      }
    }
    else if (action.effectType === 'status_apply') {
      if (SELF_GENERAL_STATUS_IDS.has(action.statusId)) this.applyGeneralStatus(action)
      else for (const enemyId of action.targetEnemyIds) this.applyStatus(player, action, enemyId)
    }
    else if (action.effectType === 'path_displacement') {
      let displaced = false
      const primary = action.primaryTargetEnemyId
        ? this.enemies.find((candidate) => candidate.id === action.primaryTargetEnemyId) : null
      for (const enemyId of action.targetEnemyIds) {
        const enemy = this.enemies.find((candidate) => candidate.id === enemyId && candidate.lifecycle === 'alive')
        if (!enemy || !this.isEnemyTargetable(enemy)) continue
        const ratio = this.enemyTags(enemy).includes('boss') ? action.bossDistanceRatioBps : 10000
        const distance = Math.floor(this.patchedNumber(action, 'distanceMilliCells', action.distanceMilliCells) * ratio / 10000)
        const before = enemy.pathProgressMilli
        const nextProgress = action.direction === 'backward' ? before - distance
          : action.direction === 'forward' ? before + distance
            : primary ? before + Math.sign(primary.pathProgressMilli - before)
              * Math.min(distance, Math.abs(primary.pathProgressMilli - before)) : before
        this.setEnemyPathProgress(enemy, Math.max(0, nextProgress))
        this.recordGeneralContribution(enemy, player.playerId, action.sourceGeneralId, 'control')
        this.emit('PATH_DISPLACED', { enemyId, generalId: action.sourceGeneralId, before, after: enemy.pathProgressMilli })
        displaced ||= enemy.pathProgressMilli !== before
      }
      if (displaced && action.actionKind !== 'passive') {
        this.executePassivePlan(player, formation, level, 'displacement_success')
      }
    }
    else if (action.effectType === 'summon_unit') this.spawnSummonedUnits(player, formation, level, action)
    else if (action.effectType === 'spawn_zone') {
      this.effectSequence += 1
      const zone: EffectZoneRuntime = {
        id: `zone-${this.effectSequence}`,
        ownerPlayerId: player.playerId,
        sourceGeneralId: action.sourceGeneralId,
        sourceFormationId: action.sourceFormationId,
        effectId: action.effectId,
        zoneId: action.zoneId,
        xMilli: action.targetPointMilli?.x ?? formation.anchorMilli.x,
        yMilli: action.targetPointMilli?.y ?? formation.anchorMilli.y,
        shape: action.shape,
        nextTick: this.currentTick,
        tickIntervalTicks: Math.max(1, Math.ceil(action.tickIntervalMs / this.tickRateMs)),
        expiresAtTick: this.currentTick + Math.max(1, Math.ceil(action.durationMs
          * this.weaponStatRatio(player.playerId, action.sourceGeneralId, 'zone_duration') / 10000 / this.tickRateMs)),
        tickEffects: action.tickEffects,
        sourceInactivePolicy: action.sourceInactivePolicy,
      }
      this.zones.push(zone)
      this.emit('ZONE_SPAWNED', { zoneId: zone.id, effectId: zone.effectId, generalId: zone.sourceGeneralId })
    }
    else if (action.effectType === 'cooldown_modify') this.applyCooldownModification(player, action)
    else {
      this.effectParameterPatches.set(
        this.effectParameterPatchKey(action),
        { operation: action.operation, value: action.value },
      )
      this.emit('GENERAL_EFFECT_APPLIED', { effectType: action.effectType, effectId: action.effectId, targetEffectId: action.targetEffectId })
    }
  }

  private executeWeaponCombatExtensions(
    player: PlayerRuntime,
    formation: GeneralFormationState,
    level: 1 | 2 | 3 | 4 | 5,
    action: GeneralCombatAction,
  ): void {
    const sources = this.weaponSources(player.playerId, formation.generalId)
    if (sources.length === 0) return
    // 后羿专武是首个端到端模板：主箭后按路径进度追加 80%/60% 两个目标。
    const hasHouyiBow = sources.some((source) => source.weaponId === 'houyi_sun_shooting_bow')
    if (hasHouyiBow && action.effectType === 'damage' && action.actionKind === 'active_skill' && action.targetIndex === 0
      && action.effectId.includes('houyi_chuanyun')) {
      const primary = this.enemies.find((enemy) => enemy.id === action.targetEnemyId)
      const extras = this.selectHouyiWeaponExtensionTargets(player, action)
      extras.forEach((enemy, index) => {
        const ratio = index === 0 ? 8000 : 6000
        this.executeGeneralCombatAction(player, formation, level, {
          ...action,
          actionId: `${action.actionId}:houyi-weapon-${index + 1}`,
          targetEnemyId: enemy.id,
          primaryTargetEnemyId: primary?.id ?? action.primaryTargetEnemyId,
          targetEnemyIds: [enemy.id],
          targetIndex: index + 1,
          delayMs: 0,
          damage: { ...action.damage, coefficientBps: Math.floor(action.damage.coefficientBps * ratio / 10000) },
        })
      })
    }
    for (const source of sources) {
      for (const trigger of source.triggers) {
        if (trigger.kind === 'on_basic_attack_hit' && action.effectType === 'damage'
          && action.actionKind === 'basic_attack' && this.prng.rollBps(trigger.chanceBps ?? 0)) {
          const enemy = this.enemies.find((entry) => entry.id === action.targetEnemyId && entry.lifecycle === 'alive')
          if (!enemy) continue
          for (const triggerAction of trigger.actions) {
            if (triggerAction.type === 'apply_status') this.applyWeaponStatus(player, formation, enemy,
              triggerAction.statusId, triggerAction.magnitudeBps, triggerAction.durationMs, source.sourceKey)
          }
        }
      }
    }
  }

  /** Must stay shared by choreography and execution so the client never advertises a guessed target. */
  private selectHouyiWeaponExtensionTargets(
    player: PlayerRuntime,
    action: GeneralCombatAction,
  ): EnemyRuntime[] {
    if (action.effectType !== 'damage' || action.actionKind !== 'active_skill' || action.targetIndex !== 0
      || !action.effectId.includes('houyi_chuanyun')
      || !this.weaponSources(player.playerId, action.sourceGeneralId)
        .some((source) => source.weaponId === 'houyi_sun_shooting_bow')) return []
    return this.enemies.filter((enemy) => enemy.lifecycle === 'alive' && this.isEnemyTargetable(enemy)
      && enemy.id !== action.targetEnemyId)
      .sort((left, right) => right.pathProgressMilli - left.pathProgressMilli || left.id.localeCompare(right.id))
      .slice(0, 2)
  }

  private generalActionGeometry(
    player: PlayerRuntime,
    formation: GeneralFormationState,
    level: 1 | 2 | 3 | 4 | 5,
    definition: GeneralDefinition,
    action: GeneralCombatAction,
    targetIds: readonly string[],
  ): NonNullable<PveRuntimeEvent['geometry']> {
    const source = { xMilli: formation.anchorMilli.x, yMilli: formation.anchorMilli.y }
    const targets = targetIds.map((targetId) => this.enemies.find((enemy) => enemy.id === targetId))
      .filter((enemy): enemy is EnemyRuntime => Boolean(enemy))
    const targeting = action.actionKind === 'active_skill' ? definition.activeSkill.targeting
      : action.actionKind === 'basic_attack' ? definition.basicAttack.targeting : null
    const primary = targets.find((target) => target.id === action.primaryTargetEnemyId) ?? targets[0]

    if (targeting?.scope === 'enemies_in_line_from_caster' && primary) {
      const rawLength = getGeneralLevelValue(targeting.lengthMilliCellsByLevel, level)
      const rawHalfWidth = getGeneralLevelValue(targeting.halfWidthMilliCellsByLevel, level)
      const length = Math.max(1, Math.floor(this.resolvePlanningEffectParameter(
        player.playerId, action.sourceGeneralId, action.sourceFormationId, action.effectId, 'lengthMilliCells', rawLength,
      )))
      const halfWidth = Math.max(0, Math.floor(this.resolvePlanningEffectParameter(
        player.playerId, action.sourceGeneralId, action.sourceFormationId, action.effectId, 'halfWidthMilliCells', rawHalfWidth,
      )))
      const dx = primary.xMilli - source.xMilli
      const dy = primary.yMilli - source.yMilli
      const magnitude = Math.hypot(dx, dy)
      if (magnitude > 0) return {
        kind: 'corridor',
        from: source,
        to: {
          xMilli: Math.round(source.xMilli + dx / magnitude * length),
          yMilli: Math.round(source.yMilli + dy / magnitude * length),
        },
        halfWidthMilliCells: halfWidth,
      }
    }
    if (targeting?.scope === 'enemies_around_primary' && primary) {
      const rawRadius = getGeneralLevelValue(targeting.radiusMilliCellsByLevel, level)
      const radius = Math.max(0, Math.floor(this.resolvePlanningEffectParameter(
        player.playerId, action.sourceGeneralId, action.sourceFormationId, action.effectId, 'radiusMilliCells', rawRadius,
      )))
      return { kind: 'circle', xMilli: primary.xMilli, yMilli: primary.yMilli, radiusMilliCells: radius }
    }
    if (action.targetPointMilli && targets.length === 0) {
      return { kind: 'point', xMilli: action.targetPointMilli.x, yMilli: action.targetPointMilli.y }
    }
    return {
      kind: 'polyline',
      points: [source, ...targets.map((target) => ({ xMilli: target.xMilli, yMilli: target.yMilli }))],
    }
  }

  private applyWeaponStatus(player: PlayerRuntime, formation: GeneralFormationState, enemy: EnemyRuntime,
    statusId: string, magnitude: number, durationMs: number, sourceKey: string): void {
    const settledDurationMs = CONTROL_STATUS_IDS.has(statusId)
      ? this.settleEnemyControlDurationMs(enemy, durationMs)
      : durationMs
    this.effectSequence += 1
    this.statuses.push({ instanceId: `status-${this.effectSequence}`, enemyId: enemy.id,
      sourceGeneralId: formation.generalId, ownerPlayerId: player.playerId, statusId,
      stackGroup: `${sourceKey}:${statusId}`, magnitude, stacks: 1, appliedAtTick: this.currentTick,
      expiresAtTick: this.currentTick + Math.max(1, Math.ceil(settledDurationMs / this.tickRateMs)) })
    this.emit('STATUS_APPLIED', { enemyId: enemy.id, generalId: formation.generalId, statusId, magnitude,
      chanceBps: 10000, durationMs: settledDurationMs, controlResistanceDownBps: 0 })
  }

  private resolvePendingCombatActions(): void {
    const due = this.pendingCombatActions.filter((entry) => entry.dueTick <= this.currentTick)
      .sort((left, right) => left.dueTick - right.dueTick || left.action.actionId.localeCompare(right.action.actionId))
    this.pendingCombatActions = this.pendingCombatActions.filter((entry) => entry.dueTick > this.currentTick)
    for (const entry of due) {
      const player = this.players.get(entry.playerId)
      if (player) this.executeGeneralCombatAction(player, entry.formation, entry.level, entry.action)
    }
  }

  private withPatchedDamage(action: GeneralDamageCombatAction): GeneralDamageCombatAction {
    return {
      ...action,
      damage: {
        ...action.damage,
        coefficientBps: this.patchedNumber(action, 'coefficientBps', action.damage.coefficientBps),
        flatDamage: this.patchedNumber(action, 'flatDamage', action.damage.flatDamage),
      },
    }
  }

  private patchedNumber(action: Pick<GeneralCombatAction, 'ownerPlayerId' | 'sourceGeneralId' | 'sourceFormationId' | 'effectId'>, parameter: string, value: number): number {
    const prefix = `${action.ownerPlayerId}\u0000${action.sourceGeneralId}\u0000${action.sourceFormationId}\u0000${action.effectId}\u0000${parameter}\u0000`
    const patches = [...this.effectParameterPatches.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, patch]) => patch)
    return patches.reduce((current, patch) => {
      if (patch.operation === 'add_flat') return current + patch.value
      if (patch.operation === 'add_ratio') return Math.floor(current * (10000 + patch.value) / 10000)
      return Math.floor(current * patch.value / 10000)
    }, value)
  }

  private resolveCombinedEffectParameter(
    ownerPlayerId: string,
    sourceGeneralId: string,
    sourceFormationId: string,
    effectId: string,
    parameter: string,
    baseValue: number,
  ): number {
    const internallyPatched = this.patchedNumber({ ownerPlayerId, sourceGeneralId, sourceFormationId, effectId }, parameter, baseValue)
    const weaponPatched = this.resolveWeaponEffectParameter(ownerPlayerId, sourceGeneralId, effectId, parameter, internallyPatched)
    return this.resolveSynergyEffectParameter(ownerPlayerId, sourceGeneralId, effectId, parameter, weaponPatched)
  }

  private resolvePlanningEffectParameter(
    ownerPlayerId: string,
    sourceGeneralId: string,
    sourceFormationId: string,
    effectId: string,
    parameter: string,
    baseValue: number,
  ): number {
    // 这些参数在目标冻结/实例创建前就必须结算；直伤与状态数值仍在执行时读取
    // 同帧刚产生的内部补丁，确保旧的“先补丁、后伤害”语义不回退。
    const planningParameters = new Set([
      'targetLimit', 'bounceRangeMilliCells', 'radiusMilliCells', 'lengthMilliCells',
      'halfWidthMilliCells', 'count', 'durationMs', 'maxOwnedAlive',
    ])
    return planningParameters.has(parameter)
      ? this.resolveCombinedEffectParameter(ownerPlayerId, sourceGeneralId, sourceFormationId, effectId, parameter, baseValue)
      : this.resolveSynergyEffectParameter(ownerPlayerId, sourceGeneralId, effectId, parameter,
          this.resolveWeaponEffectParameter(ownerPlayerId, sourceGeneralId, effectId, parameter, baseValue))
  }

  private resolveWeaponEffectParameter(
    ownerPlayerId: string,
    sourceGeneralId: string,
    effectId: string,
    parameter: string,
    baseValue: number,
  ): number {
    const matchesEffect = (targetEffectId: string) => targetEffectId === effectId
      || (sourceGeneralId === 'houyi' && targetEffectId.startsWith('houyi_chuanyun') && effectId.startsWith('houyi_chuanyun'))
      || targetEffectId === 'basic_attack' && effectId.includes('basic')
    const patches = this.weaponSources(ownerPlayerId, sourceGeneralId)
      .flatMap((source) => source.parameterPatches.map((patch) => ({ source: source.sourceKey, patch })))
      .filter(({ patch }) => patch.parameter === parameter && matchesEffect(patch.targetEffectId))
      .sort((left, right) => `${left.source}:${left.patch.patchId}`.localeCompare(`${right.source}:${right.patch.patchId}`))
    return patches.reduce((value, { patch }) => patch.operation === 'add_flat' ? value + patch.value
      : patch.operation === 'add_ratio' ? Math.floor(value * (10000 + patch.value) / 10000)
        : Math.floor(value * patch.value / 10000), baseValue)
  }

  private effectParameterPatchKey(action: Extract<GeneralCombatAction, { effectType: 'effect_parameter_patch' }>): string {
    return [action.ownerPlayerId, action.sourceGeneralId, action.sourceFormationId, action.targetEffectId, action.parameter,
      action.actionKind, action.effectId].join('\u0000')
  }

  private applyStatus(
    player: PlayerRuntime,
    action: Extract<GeneralCombatAction, { effectType: 'status_apply' }>,
    enemyId: string,
  ): void {
    const enemy = this.enemies.find((candidate) => candidate.id === enemyId && candidate.lifecycle === 'alive')
    if (!enemy || !this.isEnemyTargetable(enemy)) return
    const magnitude = this.patchedNumber(action, 'magnitude', action.magnitude)
    const resistanceDown = action.statusId === 'control_resistance_down'
      ? 0 : this.statusMagnitude(enemyId, 'control_resistance_down')
    const settledChanceBps = CONTROL_STATUS_IDS.has(action.statusId)
      ? Math.min(10000, Math.floor(action.chanceBps * (10000 + resistanceDown) / 10000))
      : action.chanceBps
    if (!this.prng.rollBps(settledChanceBps)) return
    let durationMs = this.settleGeneralSynergyStat({ playerId: player.playerId,
      generalId: action.sourceGeneralId, stat: 'controlDuration', baseValue: action.durationMs,
      targetTags: this.enemyTags(enemy), effectTags: ['status_apply', action.statusId, action.actionKind] })
    if (CONTROL_STATUS_IDS.has(action.statusId)) {
      durationMs = Math.floor(durationMs
        * this.weaponStatRatio(player.playerId, action.sourceGeneralId, 'control_duration', this.enemyTags(enemy)) / 10000
        * (10000 + this.passiveCombatRatio(player, action.sourceGeneralId, 'controlDuration')) / 10000)
    }
    if (CONTROL_STATUS_IDS.has(action.statusId)) {
      durationMs = Math.floor(durationMs * (10000 + resistanceDown) / 10000)
      durationMs = this.settleEnemyControlDurationMs(enemy, durationMs)
    }

    // 杨戬“当前生命斩”是瞬时效果，不创建持续状态；每次都以执行瞬间的当前生命结算。
    if (action.statusId === 'current_hp_physical_damage') {
      const rawDamage = Math.max(1, Math.floor(enemy.currentHp * Math.max(0, magnitude) / 10000))
      this.applyRuntimeEffectDamage(enemy, player.playerId, action.sourceGeneralId, action.sourceFormationId,
        action.effectId, 'physical', rawDamage, 'passive')
      this.emit('GENERAL_EFFECT_APPLIED', { effectType: action.effectType, effectId: action.effectId,
        statusId: action.statusId, enemyId, currentHpRatioBps: magnitude })
      return
    }
    const expiresAtTick = this.currentTick + Math.max(1, Math.ceil(durationMs / this.tickRateMs))
    const existing = this.statuses.find((status) => status.enemyId === enemyId && status.stackGroup === action.stacking.stackGroup)
    if (existing && action.stacking.policy !== 'independent') {
      if (action.stacking.policy === 'stack') {
        existing.stacks = Math.min(action.stacking.maxStacks, existing.stacks + 1)
        existing.magnitude = Math.max(existing.magnitude, magnitude)
      }
      else if (action.stacking.policy === 'strongest_refresh') existing.magnitude = Math.max(existing.magnitude, magnitude)
      else existing.magnitude = magnitude
      existing.expiresAtTick = action.stacking.policy === 'extend'
        ? existing.expiresAtTick + Math.max(1, Math.ceil(durationMs / this.tickRateMs)) : expiresAtTick
    }
    else {
      this.effectSequence += 1
      this.statuses.push({ instanceId: `status-${this.effectSequence}`, enemyId, sourceGeneralId: action.sourceGeneralId,
        ownerPlayerId: player.playerId, statusId: action.statusId, stackGroup: action.stacking.stackGroup,
        magnitude, stacks: 1, appliedAtTick: this.currentTick, expiresAtTick })
    }
    this.recordGeneralContribution(enemy, player.playerId, action.sourceGeneralId, 'control')
    this.emit('STATUS_APPLIED', { enemyId, generalId: action.sourceGeneralId, statusId: action.statusId, magnitude,
      chanceBps: settledChanceBps, durationMs, controlResistanceDownBps: resistanceDown })
  }

  private applyGeneralStatus(
    action: Extract<GeneralCombatAction, { effectType: 'status_apply' }>,
  ): void {
    if (!this.isFormationActive(action.ownerPlayerId, action.sourceGeneralId, action.sourceFormationId)
      || !this.prng.rollBps(action.chanceBps)) return
    const definition = this.getGeneralDefinition(action.sourceGeneralId)
    const progressBefore = this.generalFormations.getProgress(action.ownerPlayerId, action.sourceGeneralId)
    const intervalBefore = definition && progressBefore
      ? resolveGeneralStats(definition, progressBefore.level,
          this.generalSynergyModifiers(action.ownerPlayerId, action.sourceGeneralId)).attackIntervalMs
      : null
    const magnitude = this.patchedNumber(action, 'magnitude', action.magnitude)
    const durationTicks = Math.max(1, Math.ceil(action.durationMs / this.tickRateMs))
    const expiresAtTick = this.currentTick + durationTicks
    const existing = this.generalStatuses.find((status) => status.ownerPlayerId === action.ownerPlayerId
      && status.sourceFormationId === action.sourceFormationId && status.stackGroup === action.stacking.stackGroup)
    if (existing && action.stacking.policy !== 'independent') {
      if (action.stacking.policy === 'stack') {
        existing.stacks = Math.min(action.stacking.maxStacks, existing.stacks + 1)
        existing.magnitude = Math.max(existing.magnitude, magnitude)
      }
      else if (action.stacking.policy === 'strongest_refresh') existing.magnitude = Math.max(existing.magnitude, magnitude)
      else existing.magnitude = magnitude
      existing.expiresAtTick = action.stacking.policy === 'extend'
        ? existing.expiresAtTick + durationTicks : expiresAtTick
    }
    else {
      this.effectSequence += 1
      this.generalStatuses.push({ instanceId: `general-status-${this.effectSequence}`,
        ownerPlayerId: action.ownerPlayerId, sourceGeneralId: action.sourceGeneralId,
        sourceFormationId: action.sourceFormationId, statusId: action.statusId,
        stackGroup: action.stacking.stackGroup, magnitude, stacks: 1,
        appliedAtTick: this.currentTick, expiresAtTick })
    }
    // 攻速 buff 在当帧按新旧间隔等比缩放剩余攻击读条，不重置整条读条。
    if (action.statusId === 'attack_speed_up' && definition && progressBefore && intervalBefore) {
      const intervalAfter = resolveGeneralStats(definition, progressBefore.level,
        this.generalSynergyModifiers(action.ownerPlayerId, action.sourceGeneralId)).attackIntervalMs
      const remaining = Math.max(0, progressBefore.nextBasicAttackTick - this.currentTick)
      if (remaining > 0 && intervalAfter !== intervalBefore) {
        this.generalFormations.replaceProgress({ ...progressBefore,
          nextBasicAttackTick: this.currentTick + Math.max(1, Math.ceil(remaining * intervalAfter / intervalBefore)) })
      }
    }
    this.emit('GENERAL_STATUS_APPLIED', { playerId: action.ownerPlayerId, generalId: action.sourceGeneralId,
      formationId: action.sourceFormationId, effectId: action.effectId, statusId: action.statusId,
      magnitude, expiresAtTick })
  }

  private applyCooldownModification(
    player: PlayerRuntime,
    action: Extract<GeneralCombatAction, { effectType: 'cooldown_modify' }>,
  ): void {
    const progress = this.generalFormations.getProgress(player.playerId, action.sourceGeneralId)
    if (!progress) return
    const apply = (readyAt: number) => action.operation === 'set_ready' ? this.currentTick
      : action.operation === 'add_ms' ? Math.max(this.currentTick, readyAt + Math.ceil(action.value / this.tickRateMs))
        : Math.max(this.currentTick, this.currentTick + Math.ceil((readyAt - this.currentTick) * (10000 + action.value) / 10000))
    this.generalFormations.replaceProgress({ ...progress,
      ...(action.targetSkill === 'active_skill' || action.targetSkill === 'all_skills' ? { activeSkillReadyAtTick: apply(progress.activeSkillReadyAtTick) } : {}),
      ...(action.targetSkill === 'basic_attack' || action.targetSkill === 'all_skills' ? { nextBasicAttackTick: apply(progress.nextBasicAttackTick) } : {}) })
    this.emit('COOLDOWN_MODIFIED', { playerId: player.playerId, generalId: action.sourceGeneralId, effectId: action.effectId,
      targetSkill: action.targetSkill, operation: action.operation, value: action.value })
  }

  private statusMagnitude(enemyId: string, statusId: string): number {
    return this.statuses.filter((status) => status.enemyId === enemyId && status.statusId === statusId && status.expiresAtTick > this.currentTick)
      .reduce((maximum, status) => Math.max(maximum, status.magnitude * status.stacks), 0)
  }

  private hasAnyControlStatus(enemyId: string): boolean {
    return this.statuses.some((status) => status.enemyId === enemyId
      && CONTROL_STATUS_IDS.has(status.statusId) && status.expiresAtTick > this.currentTick)
  }

  private hasEnemyStatus(enemyId: string, statusId: string): boolean {
    return this.statuses.some((status) => status.enemyId === enemyId && status.statusId === statusId
      && status.expiresAtTick > this.currentTick)
  }

  private consumeGeneralStatus(
    ownerPlayerId: string,
    sourceGeneralId: string,
    sourceFormationId: string,
    statusId: string,
  ): PveGeneralStatusSnapshot | null {
    const index = this.generalStatuses.findIndex((status) => status.ownerPlayerId === ownerPlayerId
      && status.sourceGeneralId === sourceGeneralId && status.sourceFormationId === sourceFormationId
      && status.statusId === statusId && status.expiresAtTick > this.currentTick)
    if (index < 0) return null
    const [consumed] = this.generalStatuses.splice(index, 1)
    this.emit('GENERAL_STATUS_CONSUMED', { instanceId: consumed.instanceId, playerId: ownerPlayerId,
      generalId: sourceGeneralId, formationId: sourceFormationId, statusId })
    return consumed
  }

  private damageVulnerabilityMagnitude(
    enemyId: string,
    sourceKind: string,
    damageType: 'physical' | 'magic' | 'true',
  ): number {
    let magnitude = this.statusMagnitude(enemyId, 'vulnerable')
      + this.statusMagnitude(enemyId, 'vulnerable_all')
    if (sourceKind === 'active_skill' || sourceKind === 'passive'
      || sourceKind === 'spawn_zone' || sourceKind === 'damage_over_time') {
      magnitude += this.statusMagnitude(enemyId, 'skill_vulnerable')
    }
    if (damageType === 'magic') magnitude += this.statusMagnitude(enemyId, 'magic_vulnerable')
    return magnitude
  }

  private recordGeneralContribution(
    enemy: EnemyRuntime,
    ownerPlayerId: string,
    generalId: string,
    category?: 'physical' | 'magic' | 'summon' | 'control',
  ): void {
    const definition = this.getGeneralDefinition(generalId)
    const resolvedCategory = category ?? definition?.archetype ?? 'physical'
    enemy.generalContributions.set(`${ownerPlayerId}:${generalId}:${resolvedCategory}`, {
      ownerPlayerId,
      generalId,
      category: resolvedCategory,
      lastContributionTick: this.currentTick,
    })
  }

  private expireEffectInstances(): void {
    const expiredStatuses = this.statuses.filter((entry) => entry.expiresAtTick <= this.currentTick)
    this.statuses = this.statuses.filter((entry) => entry.expiresAtTick > this.currentTick
      && this.enemies.some((enemy) => enemy.id === entry.enemyId && enemy.lifecycle === 'alive'))
    for (const status of expiredStatuses) this.emit('STATUS_EXPIRED', { instanceId: status.instanceId, enemyId: status.enemyId, statusId: status.statusId })
    const expiredGeneralStatuses = this.generalStatuses.filter((entry) => entry.expiresAtTick <= this.currentTick
      || !this.isFormationActive(entry.ownerPlayerId, entry.sourceGeneralId, entry.sourceFormationId))
    const expiredGeneralStatusIds = new Set(expiredGeneralStatuses.map((entry) => entry.instanceId))
    this.generalStatuses = this.generalStatuses.filter((entry) => !expiredGeneralStatusIds.has(entry.instanceId))
    for (const status of expiredGeneralStatuses) this.emit('GENERAL_STATUS_EXPIRED', {
      instanceId: status.instanceId, playerId: status.ownerPlayerId, generalId: status.sourceGeneralId,
      formationId: status.sourceFormationId, statusId: status.statusId,
    })
    this.damageOverTime = this.damageOverTime.filter((entry) => entry.expiresAtTick > this.currentTick
      && this.enemies.some((enemy) => enemy.id === entry.enemyId && enemy.lifecycle === 'alive'))

    const expiredSummons = this.summonedUnits.filter((entry) => entry.expiresAtTick <= this.currentTick
      || (entry.sourceInactivePolicy === 'despawn' && !this.isGeneralActive(entry.ownerPlayerId, entry.sourceGeneralId)))
    const expiredSummonIds = new Set(expiredSummons.map((entry) => entry.id))
    this.summonedUnits = this.summonedUnits.filter((entry) => !expiredSummonIds.has(entry.id))
    for (const summon of expiredSummons) this.emit('SUMMON_EXPIRED', { summonId: summon.id, summonUnitId: summon.summonUnitId })

    const expiredZones = this.zones.filter((entry) => entry.expiresAtTick <= this.currentTick
      || (entry.sourceInactivePolicy === 'despawn' && !this.isGeneralActive(entry.ownerPlayerId, entry.sourceGeneralId)))
    const expiredZoneIds = new Set(expiredZones.map((entry) => entry.id))
    this.zones = this.zones.filter((entry) => !expiredZoneIds.has(entry.id))
    for (const zone of expiredZones) this.emit('ZONE_EXPIRED', { zoneId: zone.id, effectId: zone.effectId })
  }

  private removeEffectsForMissingEnemies(): void {
    const aliveEnemyIds = new Set(this.enemies.map((enemy) => enemy.id))
    this.statuses = this.statuses.filter((status) => aliveEnemyIds.has(status.enemyId))
    this.damageOverTime = this.damageOverTime.filter((dot) => aliveEnemyIds.has(dot.enemyId))
  }

  private resolveDamageOverTime(): void {
    for (const dot of this.damageOverTime.slice().sort((left, right) => left.instanceId.localeCompare(right.instanceId))) {
      if (dot.nextTick > this.currentTick || dot.expiresAtTick < this.currentTick) continue
      const target = this.enemies.find((enemy) => enemy.id === dot.enemyId && enemy.lifecycle === 'alive')
      if (!target || !this.isEnemyTargetable(target)) continue
      const rawDamage = Math.max(1, Math.floor(dot.baseAttack * dot.coefficientBpsPerTick / 10000 + dot.flatDamagePerTick))
      this.applyRuntimeEffectDamage(target, dot.ownerPlayerId, dot.sourceGeneralId, dot.sourceFormationId,
        dot.instanceId, dot.damageType, rawDamage, 'damage_over_time')
      dot.nextTick += dot.tickIntervalTicks
    }
  }

  private spawnSummonedUnits(
    player: PlayerRuntime,
    formation: GeneralFormationState,
    level: 1 | 2 | 3 | 4 | 5,
    action: Extract<GeneralCombatAction, { effectType: 'summon_unit' }>,
  ): void {
    const template = (SUMMON_UNIT_CATALOG as Readonly<Record<string, SummonUnitTemplate>>)[action.summonUnitId]
    if (!template) return
    const alive = this.summonedUnits.filter((entry) => entry.ownerPlayerId === player.playerId
      && entry.sourceGeneralId === action.sourceGeneralId && entry.summonUnitId === action.summonUnitId).length
    const aliveLimitWeapon = this.weaponSummonModifier(player.playerId, action.sourceGeneralId, 'summon_alive_limit')
    const maxOwnedAlive = Math.max(0, Math.floor(action.maxOwnedAlive + aliveLimitWeapon.flat))
    const count = Math.max(0, Math.min(Math.floor(action.count), maxOwnedAlive - alive))
    let durationMs = this.settleSummonSynergyStat({ ownerPlayerId: player.playerId,
      sourceGeneralId: action.sourceGeneralId, summonUnitId: action.summonUnitId,
      stat: 'summonDuration', baseValue: action.durationMs })
    const durationWeapon = this.weaponSummonModifier(player.playerId, action.sourceGeneralId, 'summon_duration')
    durationMs = Math.max(1, Math.floor(durationMs * durationWeapon.ratio / 10000
      * (10000 + this.passiveCombatRatio(player, action.sourceGeneralId, 'summonDuration')) / 10000))
    for (let index = 0; index < count; index += 1) {
      this.effectSequence += 1
      const spawnPoint = this.resolveSummonSpawnPoint(player, formation, action, index)
      const summon: SummonedUnitRuntime = {
        id: `summon-${this.effectSequence}`,
        ownerPlayerId: player.playerId,
        sourceGeneralId: action.sourceGeneralId,
        sourceFormationId: action.sourceFormationId,
        summonUnitId: action.summonUnitId,
        sourceEffectId: action.effectId,
        glyph: template.glyph,
        xMilli: spawnPoint.xMilli,
        yMilli: spawnPoint.yMilli,
        ownerLevel: level,
        nextAttackTick: this.currentTick + Math.max(1, Math.ceil(
          getGeneralLevelValue(template.baseStats.attackIntervalMsByOwnerLevel, level) / this.tickRateMs,
        )),
        expiresAtTick: this.currentTick + Math.max(1, Math.ceil(durationMs / this.tickRateMs)),
        template,
        inheritStatRatiosBps: action.inheritStatRatiosBps,
        sourceInactivePolicy: action.sourceInactivePolicy,
      }
      this.summonedUnits.push(summon)
      const actionId = `${formation.formationId}:${action.actionId}:summon:${index}`
      this.emit('SUMMON_SPAWNED', {
        summonId: summon.id,
        summonUnitId: summon.summonUnitId,
        generalId: summon.sourceGeneralId,
        spawnPattern: action.spawnPattern,
        xMilli: summon.xMilli,
        yMilli: summon.yMilli,
        targetXMilli: action.targetPointMilli?.x ?? null,
        targetYMilli: action.targetPointMilli?.y ?? null,
        actionId,
        targetIds: [summon.id],
      }, {
        actionId,
        targetIds: [summon.id],
        geometry: { kind: 'point', xMilli: summon.xMilli, yMilli: summon.yMilli },
      })
    }
  }

  private resolveSummonSpawnPoint(
    player: PlayerRuntime,
    formation: GeneralFormationState,
    action: Extract<GeneralCombatAction, { effectType: 'summon_unit' }>,
    index: number,
  ): { xMilli: number, yMilli: number } {
    const radius = Math.max(0, Math.floor(action.spawnRadiusMilliCells))
    const occupied = this.summonSpawnOccupiedPointKeys()
    const pointKey = (point: { xMilli: number, yMilli: number }): string => `${point.xMilli},${point.yMilli}`
    const surroundingOffsets = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
    ] as const
    if (action.spawnPattern === 'owner_random_empty_board_cell') {
      const candidates: Array<{ xMilli: number, yMilli: number }> = []
      for (let y = 0; y < PVE_ARENA_GRID_SIZE; y += 1) {
        for (let x = 0; x < PVE_ARENA_GRID_SIZE; x += 1) {
          const candidate = { xMilli: x * 1000, yMilli: y * 1000 }
          if (this.isDeployableCell(player.slot, x, y) && !occupied.has(pointKey(candidate))) candidates.push(candidate)
        }
      }
      return candidates.length > 0
        ? candidates[this.prng.nextInt(candidates.length)]!
        : { xMilli: formation.anchorMilli.x, yMilli: formation.anchorMilli.y }
    }

    if (action.spawnPattern === 'path_side_nearest_empty') {
      const nearest = this.nearestLanePathPoint(player.slot, formation.anchorMilli.x, formation.anchorMilli.y)
      const stride = Math.max(500, Math.floor(radius / 2))
      for (let offset = index; offset < index + 32; offset += 1) {
        const side = offset % 2 === 0 ? 1 : -1
        const along = Math.floor(offset / 2) * stride
        const candidate = {
          xMilli: nearest.xMilli + nearest.perpendicularX * radius * side + nearest.tangentX * along,
          yMilli: nearest.yMilli + nearest.perpendicularY * radius * side + nearest.tangentY * along,
        }
        if (!occupied.has(pointKey(candidate))) return candidate
      }
      return { xMilli: nearest.xMilli, yMilli: nearest.yMilli }
    }

    const center = action.spawnPattern === 'target_surrounding' && action.targetPointMilli
      ? action.targetPointMilli : formation.anchorMilli
    for (let offset = index; offset < index + surroundingOffsets.length; offset += 1) {
      const [offsetX, offsetY] = surroundingOffsets[offset % surroundingOffsets.length]!
      const candidate = { xMilli: center.x + offsetX * radius, yMilli: center.y + offsetY * radius }
      if (!occupied.has(pointKey(candidate))) return candidate
    }
    return { xMilli: center.x, yMilli: center.y }
  }

  /**
   * “空位”只在召唤瞬间用于选点：不给单位增加持续碰撞或禁止后续技能聚怪。
   * 前一个同批次召唤物已写入 summonedUnits，因而也会被下一个排除。
   */
  private summonSpawnOccupiedPointKeys(): ReadonlySet<string> {
    const occupied = new Set<string>()
    for (const player of this.players.values()) {
      for (const entry of player.board.values()) occupied.add(`${entry.x * 1000},${entry.y * 1000}`)
    }
    for (const summon of this.summonedUnits) occupied.add(`${summon.xMilli},${summon.yMilli}`)
    return occupied
  }

  private nearestLanePathPoint(
    slot: PveLaneSlot,
    xMilli: number,
    yMilli: number,
  ): {
    xMilli: number
    yMilli: number
    tangentX: -1 | 0 | 1
    tangentY: -1 | 0 | 1
    perpendicularX: -1 | 0 | 1
    perpendicularY: -1 | 0 | 1
  } {
    const route = this.laneRoutes[slot]
    let best: {
      xMilli: number
      yMilli: number
      tangentX: -1 | 0 | 1
      tangentY: -1 | 0 | 1
      perpendicularX: -1 | 0 | 1
      perpendicularY: -1 | 0 | 1
    } | null = null
    let bestDistanceSquared = Number.POSITIVE_INFINITY
    for (let index = 0; index < route.waypoints.length - 1; index += 1) {
      const from = route.waypoints[index]!
      const to = route.waypoints[index + 1]!
      const fromX = from.x * 1000
      const fromY = from.y * 1000
      const toX = to.x * 1000
      const toY = to.y * 1000
      const tangentX = Math.sign(toX - fromX) as -1 | 0 | 1
      const tangentY = Math.sign(toY - fromY) as -1 | 0 | 1
      const pointX = tangentX === 0 ? fromX : Math.min(Math.max(xMilli, Math.min(fromX, toX)), Math.max(fromX, toX))
      const pointY = tangentY === 0 ? fromY : Math.min(Math.max(yMilli, Math.min(fromY, toY)), Math.max(fromY, toY))
      const distanceSquared = this.distanceSquared(xMilli, yMilli, pointX, pointY)
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        best = {
          xMilli: pointX,
          yMilli: pointY,
          tangentX,
          tangentY,
          perpendicularX: (-tangentY) as -1 | 0 | 1,
          perpendicularY: tangentX,
        }
      }
    }
    return best ?? {
      xMilli,
      yMilli,
      tangentX: 1,
      tangentY: 0,
      perpendicularX: 0,
      perpendicularY: 1,
    }
  }

  private resolveSummonedUnitAttacks(): void {
    for (const summon of this.summonedUnits.slice().sort((left, right) => left.id.localeCompare(right.id))) {
      if (summon.nextAttackTick > this.currentTick) continue
      const rangeWeapon = this.weaponSummonModifier(summon.ownerPlayerId, summon.sourceGeneralId, 'summon_attack_range')
      const range = Math.max(0, Math.floor(getGeneralLevelValue(
        summon.template.baseStats.attackRangeMilliCellsByOwnerLevel, summon.ownerLevel) * rangeWeapon.ratio / 10000
        + rangeWeapon.flat))
      const target = this.enemies.filter((enemy) => enemy.lifecycle === 'alive' && this.isEnemyTargetable(enemy)
        && this.distanceSquared(summon.xMilli, summon.yMilli, enemy.xMilli, enemy.yMilli) <= range * range)
        .sort((left, right) => this.compareEnemyPriority(left, right))[0]
      if (!target) continue
      const definition = this.getGeneralDefinition(summon.sourceGeneralId)
      const ownerStats = definition ? resolveGeneralStats(definition, summon.ownerLevel,
        this.generalSynergyModifiers(summon.ownerPlayerId, summon.sourceGeneralId)) : null
      const templateAttack = getGeneralLevelValue(summon.template.baseStats.attackByOwnerLevel, summon.ownerLevel)
      const inheritedAttack = Math.floor((ownerStats?.attack ?? 0) * (summon.inheritStatRatiosBps.attack ?? 0) / 10000)
      const allStatsRatio = this.resolveCombinedEffectParameter(summon.ownerPlayerId, summon.sourceGeneralId,
        summon.sourceFormationId, summon.sourceEffectId, 'summonAllStatsBps', 10000)
      const internalAttackRatio = this.resolveCombinedEffectParameter(summon.ownerPlayerId, summon.sourceGeneralId,
        summon.sourceFormationId, summon.sourceEffectId, 'summonAttackBps', 10000)
      let summonAttack = this.settleSummonSynergyStat({ ownerPlayerId: summon.ownerPlayerId,
        sourceGeneralId: summon.sourceGeneralId, summonUnitId: summon.summonUnitId,
        stat: 'summonAttack', baseValue: Math.floor((templateAttack + inheritedAttack)
          * allStatsRatio / 10000 * internalAttackRatio / 10000) })
      const summonAttackWeapon = this.weaponSummonModifier(summon.ownerPlayerId, summon.sourceGeneralId, 'summon_attack')
      summonAttack = Math.max(1, Math.floor(summonAttack * summonAttackWeapon.ratio / 10000 + summonAttackWeapon.flat))
      const internalCritRate = this.resolveCombinedEffectParameter(summon.ownerPlayerId, summon.sourceGeneralId,
        summon.sourceFormationId, summon.sourceEffectId, 'summonCritRateBps',
        getGeneralLevelValue(summon.template.baseStats.critChanceBpsByOwnerLevel, summon.ownerLevel))
      const critRateWeapon = this.weaponSummonModifier(summon.ownerPlayerId, summon.sourceGeneralId, 'summon_crit_rate')
      const critChance = Math.min(10000, Math.max(0, this.settleSummonSynergyStat({
        ownerPlayerId: summon.ownerPlayerId, sourceGeneralId: summon.sourceGeneralId,
        summonUnitId: summon.summonUnitId, stat: 'summonCritRate',
        baseValue: Math.floor(internalCritRate * allStatsRatio / 10000),
      }) * critRateWeapon.ratio / 10000 + critRateWeapon.flat))
      const bossCritDamage = this.enemyTags(target).includes('boss')
        ? this.resolveCombinedEffectParameter(summon.ownerPlayerId, summon.sourceGeneralId,
            summon.sourceFormationId, summon.sourceEffectId, 'bossCritDamageBps', 0) : 0
      const critDamageWeapon = this.weaponSummonModifier(summon.ownerPlayerId, summon.sourceGeneralId, 'summon_crit_damage')
      const critDamage = Math.max(10000, this.settleSummonSynergyStat({ ownerPlayerId: summon.ownerPlayerId,
        sourceGeneralId: summon.sourceGeneralId, summonUnitId: summon.summonUnitId,
        stat: 'summonCritDamage',
        baseValue: Math.floor(getGeneralLevelValue(summon.template.baseStats.critDamageBpsByOwnerLevel, summon.ownerLevel)
          * allStatsRatio / 10000) + bossCritDamage,
      }) * critDamageWeapon.ratio / 10000 + critDamageWeapon.flat)
      const isCritical = summon.template.basicAttack.criticalPolicy === 'can_crit' && this.prng.rollBps(critChance)
      let rawDamage = Math.max(1, Math.floor(summonAttack * summon.template.basicAttack.coefficientBps / 10000))
      const summonDamageWeapon = this.weaponSummonModifier(summon.ownerPlayerId, summon.sourceGeneralId, 'summon_damage')
      const ownerPlayer = this.players.get(summon.ownerPlayerId)
      rawDamage = Math.max(1, Math.floor(rawDamage * summonDamageWeapon.ratio / 10000
        * (10000 + (ownerPlayer ? this.passiveCombatRatio(ownerPlayer, summon.sourceGeneralId, 'summonDamage') : 0)) / 10000))
      if (isCritical) rawDamage = Math.max(1, Math.floor(rawDamage * critDamage / 10000))
      this.applyRuntimeEffectDamage(target, summon.ownerPlayerId, summon.sourceGeneralId, summon.sourceFormationId,
        summon.template.basicAttack.attackId, summon.template.damageType, rawDamage, 'summon')
      const interval = getGeneralLevelValue(summon.template.baseStats.attackIntervalMsByOwnerLevel, summon.ownerLevel)
      const speedRatio = this.settleSummonSynergyStat({ ownerPlayerId: summon.ownerPlayerId,
        sourceGeneralId: summon.sourceGeneralId, summonUnitId: summon.summonUnitId,
        stat: 'summonAttackSpeed', baseValue: allStatsRatio })
      const speedWeapon = this.weaponSummonModifier(summon.ownerPlayerId, summon.sourceGeneralId, 'summon_attack_speed')
      const settledInterval = Math.max(200, Math.ceil(interval * 10000
        / Math.max(1, speedRatio) * 10000 / Math.max(1, speedWeapon.ratio + speedWeapon.flat)))
      summon.nextAttackTick = this.currentTick + Math.max(1, Math.ceil(settledInterval / this.tickRateMs))
      for (const onHit of summon.template.onHitStatuses) {
        this.applySimpleStatus(target, summon.ownerPlayerId, summon.sourceGeneralId, onHit.statusId, onHit.magnitudeBps,
          onHit.durationMs, onHit.chanceBps, onHit.stackGroup)
      }
      const dot = summon.template.onHitDamageOverTime
      if (dot) {
        this.effectSequence += 1
        this.damageOverTime.push({ instanceId: `dot-${this.effectSequence}`, enemyId: target.id,
          ownerPlayerId: summon.ownerPlayerId, sourceGeneralId: summon.sourceGeneralId,
          sourceFormationId: summon.sourceFormationId, damageType: dot.damageType,
          baseAttack: ownerStats?.attack ?? templateAttack,
          coefficientBpsPerTick: this.resolveCombinedEffectParameter(summon.ownerPlayerId,
            summon.sourceGeneralId, summon.sourceFormationId, dot.effectId,
            'ownerAttackCoefficientBpsPerTick', dot.ownerAttackCoefficientBpsPerTick),
          flatDamagePerTick: 0, nextTick: this.currentTick + Math.max(1, Math.ceil(dot.tickIntervalMs / this.tickRateMs)),
          tickIntervalTicks: Math.max(1, Math.ceil(dot.tickIntervalMs / this.tickRateMs)),
          expiresAtTick: this.currentTick + Math.max(1, Math.ceil(dot.durationMs / this.tickRateMs)), stackGroup: dot.stackGroup })
      }
    }
  }

  private resolveZones(): void {
    for (const zone of this.zones.slice().sort((left, right) => left.id.localeCompare(right.id))) {
      if (zone.nextTick > this.currentTick || zone.expiresAtTick < this.currentTick) continue
      const targets = this.enemies.filter((enemy) => enemy.lifecycle === 'alive' && this.isEnemyTargetable(enemy)
        && this.isEnemyInsideZone(enemy, zone)).sort((left, right) => this.compareEnemyPriority(left, right))
      for (const effect of zone.tickEffects) this.applyZoneTickEffect(zone, effect, targets)
      zone.nextTick += zone.tickIntervalTicks
    }
  }

  private isEnemyInsideZone(enemy: EnemyRuntime, zone: EffectZoneRuntime): boolean {
    if (zone.shape.kind === 'circle') {
      return this.distanceSquared(zone.xMilli, zone.yMilli, enemy.xMilli, enemy.yMilli)
        <= zone.shape.radiusMilliCells * zone.shape.radiusMilliCells
    }
    // 持续直线区域首版以中心点为起点、沿 +X 方向；后续将施法方向加入快照。
    const dx = enemy.xMilli - zone.xMilli
    const dy = Math.abs(enemy.yMilli - zone.yMilli)
    return dx >= 0 && dx <= zone.shape.lengthMilliCells && dy <= zone.shape.halfWidthMilliCells
  }

  private applyZoneTickEffect(
    zone: EffectZoneRuntime,
    effect: GeneralZoneTickEffectDefinition,
    targets: readonly EnemyRuntime[],
  ): void {
    const definition = this.getGeneralDefinition(zone.sourceGeneralId)
    const progress = this.generalFormations.getProgress(zone.ownerPlayerId, zone.sourceGeneralId)
    const level = progress?.level ?? 1
    const stats = definition ? resolveGeneralStats(definition, level, this.generalSynergyModifiers(zone.ownerPlayerId, zone.sourceGeneralId)) : null
    const configuredLimit = effect.targeting?.scope === 'self' ? 0 : effect.targeting?.targetLimit ?? targets.length
    const targetLimit = Math.max(0, Math.floor(this.resolveCombinedEffectParameter(zone.ownerPlayerId,
      zone.sourceGeneralId, zone.sourceFormationId, effect.effectId, 'targetLimit', configuredLimit)))
    for (const target of targets.slice(0, targetLimit)) {
      if (effect.type === 'damage') {
        const coefficient = this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId,
          zone.sourceFormationId, effect.effectId, 'coefficientBps', getGeneralLevelValue(effect.coefficientBpsByLevel, level))
        const flatDamage = this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId,
          zone.sourceFormationId, effect.effectId, 'flatDamage', getGeneralLevelValue(effect.flatDamageByLevel, level))
        const raw = Math.max(1, Math.floor((stats?.attack ?? 1) * coefficient / 10000 + flatDamage))
        this.applyRuntimeEffectDamage(target, zone.ownerPlayerId, zone.sourceGeneralId, zone.sourceFormationId,
          effect.effectId, effect.damageType, raw, 'spawn_zone')
      }
      else if (effect.type === 'status_apply') this.applySimpleStatus(target, zone.ownerPlayerId, zone.sourceGeneralId,
        effect.statusId,
        this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId, zone.sourceFormationId,
          effect.effectId, 'magnitude', getGeneralLevelValue(effect.magnitudeByLevel, level)),
        this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId, zone.sourceFormationId,
          effect.effectId, 'durationMs', getGeneralLevelValue(effect.durationMsByLevel, level)),
        this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId, zone.sourceFormationId,
          effect.effectId, 'chanceBps', getGeneralLevelValue(effect.chanceBpsByLevel, level)), effect.stacking.stackGroup)
      else if (effect.type === 'path_displacement') {
        const before = target.pathProgressMilli
        const distance = this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId,
          zone.sourceFormationId, effect.effectId, 'distanceMilliCells', getGeneralLevelValue(effect.distanceMilliCellsByLevel, level))
        this.setEnemyPathProgress(target, Math.max(0, before + (effect.direction === 'backward' ? -distance : distance)))
      }
      else {
        this.effectSequence += 1
        this.damageOverTime.push({ instanceId: `dot-${this.effectSequence}`, enemyId: target.id,
          ownerPlayerId: zone.ownerPlayerId, sourceGeneralId: zone.sourceGeneralId, sourceFormationId: zone.sourceFormationId,
          damageType: effect.damageType, baseAttack: stats?.attack ?? 1,
          coefficientBpsPerTick: this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId,
            zone.sourceFormationId, effect.effectId, 'coefficientBpsPerTick', getGeneralLevelValue(effect.coefficientBpsPerTickByLevel, level)),
          flatDamagePerTick: this.resolveCombinedEffectParameter(zone.ownerPlayerId, zone.sourceGeneralId,
            zone.sourceFormationId, effect.effectId, 'flatDamagePerTick', getGeneralLevelValue(effect.flatDamagePerTickByLevel, level)),
          nextTick: this.currentTick + Math.max(1, Math.ceil(effect.tickIntervalMs / this.tickRateMs)),
          tickIntervalTicks: Math.max(1, Math.ceil(effect.tickIntervalMs / this.tickRateMs)),
          expiresAtTick: this.currentTick + Math.max(1, Math.ceil(this.resolveCombinedEffectParameter(zone.ownerPlayerId,
            zone.sourceGeneralId, zone.sourceFormationId, effect.effectId, 'durationMs',
            getGeneralLevelValue(effect.durationMsByLevel, level)) / this.tickRateMs)),
          stackGroup: effect.stacking.stackGroup })
      }
    }
  }

  private applySimpleStatus(
    enemy: EnemyRuntime,
    ownerPlayerId: string,
    sourceGeneralId: string,
    statusId: string,
    magnitude: number,
    durationMs: number,
    chanceBps: number,
    stackGroup: string,
  ): void {
    if (!this.isEnemyTargetable(enemy)) return
    const resistanceDown = statusId === 'control_resistance_down'
      ? 0 : this.statusMagnitude(enemy.id, 'control_resistance_down')
    const settledChanceBps = CONTROL_STATUS_IDS.has(statusId)
      ? Math.min(10000, Math.floor(chanceBps * (10000 + resistanceDown) / 10000))
      : chanceBps
    if (!this.prng.rollBps(settledChanceBps)) return
    this.effectSequence += 1
    const existing = this.statuses.find((entry) => entry.enemyId === enemy.id && entry.stackGroup === stackGroup)
    const settledDurationMs = this.settleGeneralSynergyStat({ playerId: ownerPlayerId,
      generalId: sourceGeneralId, stat: 'controlDuration', baseValue: durationMs,
      targetTags: this.enemyTags(enemy), effectTags: ['status_apply', statusId] })
    const controlAdjustedDurationMs = CONTROL_STATUS_IDS.has(statusId)
      ? this.settleEnemyControlDurationMs(enemy,
          Math.floor(settledDurationMs * (10000 + resistanceDown) / 10000))
      : settledDurationMs
    const expiresAtTick = this.currentTick + Math.max(1, Math.ceil(controlAdjustedDurationMs / this.tickRateMs))
    if (existing) { existing.magnitude = Math.max(existing.magnitude, magnitude); existing.expiresAtTick = expiresAtTick }
    else this.statuses.push({ instanceId: `status-${this.effectSequence}`, enemyId: enemy.id, sourceGeneralId,
      ownerPlayerId, statusId, stackGroup, magnitude, stacks: 1, appliedAtTick: this.currentTick, expiresAtTick })
    this.recordGeneralContribution(enemy, ownerPlayerId, sourceGeneralId, 'control')
  }

  private applyRuntimeEffectDamage(
    target: EnemyRuntime,
    ownerPlayerId: string,
    sourceGeneralId: string,
    sourceFormationId: string,
    effectId: string,
    damageType: 'physical' | 'magic' | 'true',
    rawDamage: number,
    sourceKind: string,
  ): void {
    if (target.lifecycle !== 'alive' || !this.isEnemyTargetable(target)) return
    const targetTags = this.enemyTags(target)
    const effectTags = [sourceKind, damageType]
    const generalDamageRatio = this.settleGeneralSynergyStat({
      playerId: ownerPlayerId, generalId: sourceGeneralId, stat: 'damageDealt', baseValue: 10000,
      targetTags, effectTags })
    const typedDamageRatio = damageType === 'true' ? 10000 : this.settleGeneralSynergyStat({
      playerId: ownerPlayerId, generalId: sourceGeneralId,
      stat: damageType === 'physical' ? 'physicalDamageBonus' : 'magicDamageBonus',
      baseValue: 10000, targetTags, effectTags,
    })
    rawDamage = Math.max(1, Math.floor(rawDamage * generalDamageRatio / 10000 * typedDamageRatio / 10000))
    const armorBreak = this.statusMagnitude(target.id, 'armor_break')
    const armor = Math.floor(target.armor * Math.max(0, 10000 - armorBreak) / 10000)
    const defense = damageType === 'true' ? 0 : damageType === 'physical' ? armor : target.magicResistance
    const reduced = damageType === 'true' ? rawDamage : Math.max(1, Math.floor(rawDamage * 100 / (100 + Math.max(0, defense))))
    const finalDamage = Math.max(1, Math.floor(reduced * (10000
      + this.damageVulnerabilityMagnitude(target.id, sourceKind, damageType)) / 10000
      * this.bossDamageTakenRatioBps(target) / 10000))
    const hpBefore = target.currentHp
    target.currentHp = Math.max(0, target.currentHp - finalDamage)
    target.lastDamagePlayerId = ownerPlayerId
    this.recordGeneralContribution(target, ownerPlayerId, sourceGeneralId,
      sourceKind === 'summon' ? 'summon' : damageType === 'physical' ? 'physical' : 'magic')
    this.emit('DAMAGE_APPLIED', { attackerId: sourceFormationId, playerId: ownerPlayerId, generalId: sourceGeneralId,
      sourceKind, effectId, enemyId: target.id, rawDamage, finalDamage, hpBefore, hpAfter: target.currentHp,
      isCritical: false, isSecondary: false })
    if (target.currentHp <= 0) this.settleEnemyDeath(target)
  }

  private resolveSoldierAttacks(): void {
    const attackers = [...this.players.values()]
      .flatMap((player) => [...player.board.values()].map((entry) => ({ player, entry })))
      .filter((candidate): candidate is { player: PlayerRuntime, entry: BoardEntry & { piece: SoldierPiece } } => isSoldier(candidate.entry.piece))
      .sort((left, right) => {
        return slotOrder(left.player.slot) - slotOrder(right.player.slot)
          || left.entry.y - right.entry.y
          || left.entry.x - right.entry.x
          || left.entry.piece.id.localeCompare(right.entry.piece.id)
      })

    for (const { player, entry } of attackers) {
      const soldier = entry.piece
      if (this.currentTick < soldier.nextAttackTick) {
        continue
      }
      const definition = getSoldierCatalogEntry(soldier.soldierType)
      const primary = this.selectPrimaryTarget(entry, soldier, definition)
      if (!primary) {
        continue
      }
      const targets = this.freezeAttackTargets(entry, soldier, definition, primary)
      const actionId = `${soldier.id}:basic:${this.currentTick}`
      const targetIds = targets.map((target) => target.id)
      const auraSpeedRatio = this.summonAuraAttackSpeedRatio(player.playerId, entry.x * 1000, entry.y * 1000)
      soldier.nextAttackTick = this.currentTick + Math.max(1, Math.ceil(
        this.attackIntervalTicks(soldier) * 10000 / Math.max(1, auraSpeedRatio),
      ))
      this.emit('BASIC_ATTACK_STARTED', {
        attackerId: soldier.id,
        playerId: player.playerId,
        targetIds,
        actionId,
      }, {
        actionId,
        targetIds,
        geometry: {
          kind: 'polyline',
          points: [
            { xMilli: entry.x * 1000, yMilli: entry.y * 1000 },
            ...targets.map((target) => ({ xMilli: target.xMilli, yMilli: target.yMilli })),
          ],
        },
      })

      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex]
        if (target.lifecycle !== 'alive') {
          continue
        }
        this.applySoldierDamage(player, soldier, definition, target, targetIndex > 0, actionId)
      }
    }
  }

  private selectPrimaryTarget(
    entry: BoardEntry,
    soldier: SoldierPiece,
    definition: SoldierCatalogEntry,
  ): EnemyRuntime | null {
    const range = getSoldierLevelValue(definition.attackRangeMilliCellsByLevel, soldier.level)
    const candidates = this.enemies.filter((enemy) => {
      if (enemy.lifecycle !== 'alive' || !this.isEnemyTargetable(enemy)) {
        return false
      }
      return this.distanceSquared(entry.x * 1000, entry.y * 1000, enemy.xMilli, enemy.yMilli) <= range * range
    })
    candidates.sort((left, right) => this.compareEnemyPriority(left, right))
    return candidates[0] ?? null
  }

  private freezeAttackTargets(
    entry: BoardEntry,
    soldier: SoldierPiece,
    definition: SoldierCatalogEntry,
    primary: EnemyRuntime,
  ): EnemyRuntime[] {
    const level = soldier.level
    const maxTargets = getSoldierLevelValue(definition.maxTargetsByLevel, level)
    if (definition.attackShape === 'single' || maxTargets <= 1) {
      return [primary]
    }
    const range = getSoldierLevelValue(definition.attackRangeMilliCellsByLevel, level)
    const attackerX = entry.x * 1000
    const attackerY = entry.y * 1000
    const candidates = this.enemies.filter((enemy) => {
      if (
        enemy.lifecycle !== 'alive'
        || enemy.id === primary.id
        || !this.isEnemyTargetable(enemy)
      ) {
        return false
      }
      if (this.distanceSquared(attackerX, attackerY, enemy.xMilli, enemy.yMilli) > range * range) {
        return false
      }
      if (definition.attackShape === 'radius') {
        const radius = getSoldierLevelValue(definition.radiusMilliCellsByLevel, level)
        return this.distanceSquared(primary.xMilli, primary.yMilli, enemy.xMilli, enemy.yMilli) <= radius * radius
      }
      return this.isOnPierceLine(attackerX, attackerY, primary, enemy,
        getSoldierLevelValue(definition.radiusMilliCellsByLevel, level))
    })
    candidates.sort((left, right) => this.compareEnemyPriority(left, right))
    return [primary, ...candidates.slice(0, maxTargets - 1)]
  }

  private isOnPierceLine(
    attackerX: number,
    attackerY: number,
    primary: EnemyRuntime,
    candidate: EnemyRuntime,
    toleranceMilli: number,
  ): boolean {
    const lineX = primary.xMilli - attackerX
    const lineY = primary.yMilli - attackerY
    const candidateX = candidate.xMilli - attackerX
    const candidateY = candidate.yMilli - attackerY
    const lineLengthSquared = lineX * lineX + lineY * lineY
    if (lineLengthSquared === 0) {
      return false
    }
    const dot = candidateX * lineX + candidateY * lineY
    if (dot < 0) {
      return false
    }
    const cross = candidateX * lineY - candidateY * lineX
    return cross * cross <= toleranceMilli * toleranceMilli * lineLengthSquared
  }

  private applySoldierDamage(
    player: PlayerRuntime,
    soldier: SoldierPiece,
    definition: SoldierCatalogEntry,
    target: EnemyRuntime,
    isSecondary: boolean,
    actionId: string,
  ): void {
    if (!this.isEnemyTargetable(target)) {
      return
    }
    let rawDamage = getSoldierLevelValue(definition.attackByLevel, soldier.level)
    if (isSecondary) {
      const ratio = getSoldierLevelValue(definition.secondaryDamageBpsByLevel, soldier.level)
      rawDamage = Math.floor(rawDamage * ratio / 10000)
    }
    const isCritical = this.prng.rollBps(getSoldierLevelValue(definition.critChanceBpsByLevel, soldier.level))
    if (isCritical) {
      rawDamage = Math.floor(
        rawDamage * getSoldierLevelValue(definition.critDamageBpsByLevel, soldier.level) / 10000,
      )
    }
    if (target.entityKind === 'boss') {
      rawDamage = Math.floor(rawDamage * getSoldierLevelValue(definition.bossDamageBpsByLevel, soldier.level) / 10000)
    }
    const finalDamage = Math.max(1, Math.floor(rawDamage * 100 / (100 + Math.max(0, target.armor))
      * this.bossDamageTakenRatioBps(target) / 10000))
    const hpBefore = target.currentHp
    target.currentHp = Math.max(0, target.currentHp - finalDamage)
    target.lastDamagePlayerId = player.playerId
    this.emit('DAMAGE_APPLIED', {
      attackerId: soldier.id,
      playerId: player.playerId,
      enemyId: target.id,
      rawDamage,
      finalDamage,
      hpBefore,
      hpAfter: target.currentHp,
      isCritical,
      isSecondary,
      actionId,
    }, { actionId, targetIds: [target.id] })
    if (target.currentHp <= 0) {
      this.settleEnemyDeath(target)
    }
  }

  private settleEnemyDeath(enemy: EnemyRuntime): void {
    if (enemy.lifecycle !== 'alive') {
      return
    }
    enemy.lifecycle = 'dead'
    this.emit('ENEMY_DIED', {
      enemyId: enemy.id,
      waveNumber: enemy.waveNumber,
      laneOwnerPlayerId: enemy.laneOwnerPlayerId,
      lastDamagePlayerId: enemy.lastDamagePlayerId,
      entityKind: enemy.entityKind,
    })
    if (enemy.entityKind === 'boss') {
      this.bossRuntime.handleBossDeath(enemy, this.currentTick,
        (type, data, choreography) => this.emit(type, data, choreography))
      this.emit('BOSS_DIED', {
        enemyId: enemy.id,
        bossDefinitionId: enemy.bossDefinitionId,
        bossName: enemy.bossName,
        waveNumber: enemy.waveNumber,
        laneOwnerPlayerId: enemy.laneOwnerPlayerId,
        lastDamagePlayerId: enemy.lastDamagePlayerId,
      })
    }
    const laneOwner = this.players.get(enemy.laneOwnerPlayerId)
    if (laneOwner) {
      laneOwner.rice += enemy.riceReward
      this.emit('RICE_GRANTED', {
        playerId: laneOwner.playerId,
        enemyId: enemy.id,
        amount: enemy.riceReward,
        reason: enemy.entityKind === 'boss' ? 'LANE_OWNER_BOSS_DEFEATED' : 'LANE_OWNER_MINION_DEFEATED',
      })
    }
    this.recordCrossLaneAssists(enemy)
    const xpByPlayer = this.settleGeneralExperience(enemy)
    for (const [playerId, xpPoints] of [...xpByPlayer.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      this.emit('GENERAL_XP_SETTLEMENT_AVAILABLE', {
        playerId,
        enemyId: enemy.id,
        xpPoints,
      })
    }
    if (enemy.lastDamagePlayerId) {
      const killer = this.players.get(enemy.lastDamagePlayerId)
      if (!killer) return
      for (const formation of this.generalFormations.getActiveFormations(killer.playerId)) {
        const progress = this.generalFormations.getProgress(killer.playerId, formation.generalId)
        if (progress) this.executePassivePlan(killer, formation, progress.level, 'enemy_killed')
      }
    }
  }

  /**
   * V2 尚无逐次天兵伤害贡献账本；可靠战绩只记录跨路线尾刀者和近 5 秒神将贡献者。
   * 它不产生经济，仅作为回放/结算层可消费的协防战绩事件。
   */
  private recordCrossLaneAssists(enemy: EnemyRuntime): void {
    const contributionWindowTicks = Math.ceil(5000 / this.tickRateMs)
    const generalIdsByPlayer = new Map<string, Set<string>>()
    for (const entry of enemy.generalContributions.values()) {
      if (entry.ownerPlayerId === enemy.laneOwnerPlayerId
        || !this.players.has(entry.ownerPlayerId)
        || this.currentTick - entry.lastContributionTick > contributionWindowTicks) continue
      const generalIds = generalIdsByPlayer.get(entry.ownerPlayerId) ?? new Set<string>()
      generalIds.add(entry.generalId)
      generalIdsByPlayer.set(entry.ownerPlayerId, generalIds)
    }
    if (enemy.lastDamagePlayerId && enemy.lastDamagePlayerId !== enemy.laneOwnerPlayerId
      && this.players.has(enemy.lastDamagePlayerId) && !generalIdsByPlayer.has(enemy.lastDamagePlayerId)) {
      generalIdsByPlayer.set(enemy.lastDamagePlayerId, new Set())
    }
    for (const [playerId, generalIds] of [...generalIdsByPlayer.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      this.emit('ASSIST_RECORDED', {
        playerId,
        enemyId: enemy.id,
        laneOwnerPlayerId: enemy.laneOwnerPlayerId,
        generalIds: [...generalIds].sort(),
        includedLastDamage: enemy.lastDamagePlayerId === playerId,
        telemetryScope: 'cross_lane_last_damage_and_recent_general_contributions',
      })
    }
  }

  private settleGeneralExperience(enemy: EnemyRuntime): ReadonlyMap<string, number> {
    const contributionWindowTicks = Math.ceil(5000 / this.tickRateMs)
    const eligible = [...enemy.generalContributions.entries()]
      .filter(([, entry]) => this.currentTick - entry.lastContributionTick <= contributionWindowTicks
        && this.players.has(entry.ownerPlayerId)
        && this.generalFormations.getProgress(entry.ownerPlayerId, entry.generalId) !== null)
      .map(([contributionKey, entry]) => ({ contributionKey, ...entry }))
    const baseAllocations = allocatePveBaseXpByContribution(enemy.experiencePoints, eligible)
    const byGeneral = new Map<string, { ownerPlayerId: string; generalId: string; basePoints: number }>()
    for (const entry of eligible) {
      const points = baseAllocations.get(entry.contributionKey) ?? 0
      if (points <= 0) continue
      const key = `${entry.ownerPlayerId}:${entry.generalId}`
      const current = byGeneral.get(key)
      if (current) current.basePoints += points
      else byGeneral.set(key, { ownerPlayerId: entry.ownerPlayerId, generalId: entry.generalId, basePoints: points })
    }
    const xpByPlayer = new Map<string, number>()
    for (const allocation of [...byGeneral.values()].sort((left, right) => (
      left.ownerPlayerId.localeCompare(right.ownerPlayerId) || left.generalId.localeCompare(right.generalId)
    ))) {
      const points = this.generalExperienceReward(allocation.ownerPlayerId, allocation.basePoints)
      const previous = this.generalFormations.getProgress(allocation.ownerPlayerId, allocation.generalId)
      const next = this.generalFormations.addExperience(
        allocation.ownerPlayerId,
        allocation.generalId,
        points,
      )
      if (!previous || !next) continue
      xpByPlayer.set(allocation.ownerPlayerId, (xpByPlayer.get(allocation.ownerPlayerId) ?? 0) + points)
      this.emit('GENERAL_XP_GRANTED', {
        playerId: allocation.ownerPlayerId,
        enemyId: enemy.id,
        generalId: allocation.generalId,
        xpPoints: points,
        experiencePoints: next.experiencePoints,
      })
      if (next.level > previous.level) {
        this.emit('GENERAL_LEVEL_UP', {
          playerId: allocation.ownerPlayerId,
          generalId: allocation.generalId,
          previousLevel: previous.level,
          level: next.level,
        })
      }
    }
    return xpByPlayer
  }

  private generalExperienceReward(playerId: string, baseExperiencePoints = XP_REWARD_POINTS): number {
    const modifiers = this.synergyEffects.query({
      subject: { kind: 'player', ownerPlayerId: playerId },
    }).statModifiers
    const synergyReward = Math.max(0, Math.floor(settleRuntimeSynergyStat({
      baseValue: baseExperiencePoints,
      stat: 'generalExperienceGain',
      modifiers,
    })))
    const player = this.players.get(playerId)
    return player?.passiveItems
      ? resolveGeneralExperience(synergyReward, player.passiveItems)
      : synergyReward
  }

  private updateLaneClearRewards(): void {
    for (const lane of this.laneWaves) {
      if (lane.retired || lane.clearRewardGranted || lane.spawnedCount < lane.totalCount
        || (lane.bossEncounter && !lane.bossSpawned) || this.hasAliveLaneEnemy(lane)) {
        continue
      }
      lane.clearRewardGranted = true
      const owner = this.players.get(lane.playerId)
      if (!owner) {
        continue
      }
      const reward = resolvePveLaneClearRiceReward(lane.waveNumber)
        + (owner.passiveItems?.ownLaneWaveClearRationsBonus ?? 0)
      owner.rice += reward
      owner.clearedWaves.add(lane.waveNumber)
      this.emit('LANE_WAVE_CLEARED', {
        playerId: owner.playerId,
        slot: owner.slot,
        waveNumber: lane.waveNumber,
        riceReward: reward,
        bossNode: lane.bossEncounter !== null,
        bossDefinitionId: lane.bossEncounter?.definition.bossDefinitionId ?? null,
      })
      this.emit('RICE_GRANTED', {
        playerId: owner.playerId,
        enemyId: null,
        amount: reward,
        reason: 'LANE_WAVE_CLEAR',
      })
    }
  }

  private updateWavePhaseAndProgression(): void {
    const currentLanes = this.currentLaneWaves()
    if (currentLanes.length === 0 || this.wavePhase === 'prep') {
      return
    }
    const allSpawned = currentLanes.every((lane) => isLaneWaveSpawningComplete({
      ordinarySpawnedCount: lane.spawnedCount,
      ordinaryTotalCount: lane.totalCount,
      bossRequired: lane.bossEncounter !== null,
      bossSpawned: lane.bossSpawned,
      retired: lane.retired,
    }))
    if (!allSpawned) {
      return
    }

    if (this.currentWaveNumber >= this.maxWaves) {
      this.wavePhase = 'clearing'
      if (this.enemies.every((enemy) => enemy.lifecycle !== 'alive')) {
        this.wavePhase = 'complete'
        this.finishMatch('victory', 'All configured waves cleared')
      }
      return
    }
    this.prepareWave(this.currentWaveNumber + 1)
    if (this.prepRemainingTicks === 0) {
      this.beginPreparedWave()
    }
  }

  private evaluateOverload(): void {
    if (this.status !== 'running' || this.enemyCapacity <= 0) {
      return
    }
    // Boss 使用每路线独立容量槽，不挤占原有“10只普通怪/人”的失败容量。
    const aliveCount = this.enemies.filter((enemy) => (
      enemy.lifecycle === 'alive' && enemy.entityKind === 'ordinary_minion'
    )).length
    this.overloadTicks = aliveCount >= this.enemyCapacity ? this.overloadTicks + 1 : 0
    if (this.overloadTicks >= Math.ceil(OVERLOAD_DURATION_MS / this.tickRateMs)) {
      this.finishMatch('defeat', 'Enemy capacity remained full for 10 seconds')
    }
  }

  private finishMatch(outcome: 'victory' | 'defeat', reason: string): void {
    if (this.status === 'finished') {
      return
    }
    this.status = 'finished'
    this.result = { outcome, reason, decidedAtTick: this.currentTick }
    this.emit('MATCH_FINISHED', { outcome, reason })
  }

  private hasAliveLaneEnemy(lane: LaneWaveRuntime): boolean {
    return this.enemies.some((enemy) => {
      return enemy.lifecycle === 'alive'
        && enemy.waveNumber === lane.waveNumber
        && enemy.laneOwnerPlayerId === lane.playerId
        && enemy.laneSlot === lane.slot
    })
  }

  private currentLaneWaves(): LaneWaveRuntime[] {
    return this.laneWaves.filter((lane) => lane.waveNumber === this.currentWaveNumber)
  }

  private reconcileGeneralFormations(player: PlayerRuntime) {
    const result = this.generalFormations.reconcilePlayer(
      player.playerId,
      [...player.board.values()].flatMap((entry) => entry.piece.kind === 'character'
        ? [{
            tokenId: entry.piece.id,
            ownerPlayerId: entry.piece.ownerPlayerId,
            glyph: entry.piece.glyph,
            x: entry.x,
            y: entry.y,
          }]
        : []),
      [...player.board.values()].filter((entry) => isSoldier(entry.piece)).length,
      player.populationCap,
      this.currentTick,
      new Set(player.selectedGeneralIds),
    )
    if (!result.ok) return result

    for (const generalId of result.activatedGeneralIds) {
      const formation = result.activeFormations.find((candidate) => candidate.generalId === generalId)
      this.emit('GENERAL_ACTIVATED', {
        playerId: player.playerId,
        generalId,
        formationId: formation?.formationId ?? null,
        characterPieceIds: formation?.characterTokenIds ?? [],
      })
      const progress = this.generalFormations.getProgress(player.playerId, generalId)
      const quality = this.getGeneralDefinition(generalId)?.quality
      if (quality && player.passiveItems?.generalLevelCaps[quality as 'purple' | 'orange']) {
        this.generalFormations.setBreakthrough(player.playerId, generalId, true)
      }
      const initializedProgress = this.generalFormations.getProgress(player.playerId, generalId) ?? progress
      if (formation && initializedProgress) this.executePassivePlan(player, formation, initializedProgress.level, 'initialize')
      for (const source of this.weaponSources(player.playerId, generalId)) {
        for (const trigger of source.triggers) {
          const triggerSupported = trigger.kind === 'on_basic_attack_hit'
            && trigger.actions.every((action) => action.type === 'apply_status')
          if (!triggerSupported) for (const action of trigger.actions) {
            this.emitUnsupportedWeaponEffectOnce(player.playerId, generalId, source, trigger.triggerId, action.type)
          }
        }
        for (const patch of source.parameterPatches) {
          const supported = generalId === 'houyi' && patch.patchId.startsWith('houyi_')
          if (!supported) this.emitUnsupportedWeaponEffectOnce(player.playerId, generalId, source,
            patch.patchId, 'parameter_patch_requires_matching_effect')
        }
      }
    }
    for (const generalId of result.deactivatedGeneralIds) {
      this.emit('GENERAL_DEACTIVATED', { playerId: player.playerId, generalId })
    }
    this.reconcilePlayerSynergies(player.playerId)
    return result
  }

  private reconcilePlayerSynergies(playerId: string): void {
    const next = evaluatePlayerSynergies({
      ownerPlayerId: playerId,
      formations: this.generalFormations.getActiveFormations(playerId).map((formation) => ({
        ownerPlayerId: playerId,
        generalId: formation.generalId,
        zone: 'board' as const,
        isFormed: true,
        isFixed: formation.fixed,
        constituentTokenIds: formation.characterTokenIds,
      })),
      profiles: GENERAL_SYNERGY_PROFILES,
      definitions: SYNERGY_V1_CATALOG,
    })
    const previous = this.synergyByPlayer.get(playerId) ?? {
      ownerPlayerId: playerId,
      activeGeneralIds: [],
      activeSynergies: [],
    }
    const reconciliation = reconcilePlayerSynergies({
      previous,
      next,
      definitions: SYNERGY_V1_CATALOG,
    })
    this.synergyEffects.applyReconcileCommands({ ownerPlayerId: playerId, commands: reconciliation.commands })
    this.synergyByPlayer.set(playerId, next)
    for (const synergy of reconciliation.activated) {
      this.emit('SYNERGY_ACTIVATED', {
        playerId,
        synergyId: synergy.synergyId,
        level: synergy.level,
        contributingGeneralIds: [...synergy.contributingGeneralIds],
      })
    }
    for (const synergy of reconciliation.deactivated) {
      this.emit('SYNERGY_DEACTIVATED', {
        playerId,
        synergyId: synergy.synergyId,
        level: synergy.level,
      })
    }
    for (const changed of reconciliation.changedLevels) {
      this.emit('SYNERGY_LEVEL_CHANGED', {
        playerId,
        synergyId: changed.next.synergyId,
        previousLevel: changed.previous.level,
        level: changed.next.level,
        contributingGeneralIds: [...changed.next.contributingGeneralIds],
      })
    }
    for (const changed of reconciliation.reconfigured) {
      this.emit('SYNERGY_RECONFIGURED', {
        playerId,
        synergyId: changed.next.synergyId,
        level: changed.next.level,
        previousContributingGeneralIds: [...changed.previous.contributingGeneralIds],
        contributingGeneralIds: [...changed.next.contributingGeneralIds],
      })
    }
  }

  private enemyTags(enemy: Pick<EnemyRuntime, 'glyph' | 'entityKind'>): string[] {
    const tags = [enemy.entityKind === 'boss' ? 'boss' : 'normal']
    if (enemy.glyph === '妖') tags.push('yao')
    if (enemy.glyph === '魔') tags.push('mo')
    return tags
  }

  private generalSynergyModifiers(
    playerId: string,
    generalId: string,
    targetTags: readonly string[] = [],
    effectTags: readonly string[] = [],
  ): GeneralStatModifier[] {
    const modifiers: GeneralStatModifier[] = this.synergyEffects.query({
      subject: { kind: 'general', ownerPlayerId: playerId, generalId },
      targetTags,
      effectTags,
    }).statModifiers.flatMap((modifier) => {
      if (!['attack', 'attackSpeed', 'attackRange', 'critRate', 'critDamage'].includes(modifier.stat)) return []
      if (modifier.operation !== 'add_flat' && modifier.operation !== 'add_ratio') return []
      return [{
        source: { kind: 'synergy' as const, sourceId: modifier.sourceId },
        target: { scope: 'self' as const },
        stat: modifier.stat as GeneralStatModifier['stat'],
        operation: modifier.operation,
        value: modifier.value,
        stackGroup: modifier.stackGroup,
      }]
    })
    const formation = this.generalFormations.getActiveFormations(playerId)
      .find((candidate) => candidate.generalId === generalId)
    if (formation) {
      const attackSpeedUp = this.generalStatuses
        .filter((status) => status.ownerPlayerId === playerId && status.sourceGeneralId === generalId
          && status.sourceFormationId === formation.formationId && status.statusId === 'attack_speed_up'
          && status.expiresAtTick > this.currentTick)
        .reduce((total, status) => total + status.magnitude * status.stacks, 0)
      if (attackSpeedUp > 0) modifiers.push({ source: { kind: 'passive', sourceId: 'attack_speed_up' },
        target: { scope: 'self' }, stat: 'attackSpeed', operation: 'add_ratio', value: attackSpeedUp,
        stackGroup: 'attack_speed_up' })
      const auraRatio = this.summonAuraAttackSpeedRatio(playerId, formation.anchorMilli.x, formation.anchorMilli.y) - 10000
      if (auraRatio > 0) modifiers.push({ source: { kind: 'passive', sourceId: 'summon_attack_speed_aura' },
        target: { scope: 'self' }, stat: 'attackSpeed', operation: 'add_ratio', value: auraRatio,
        stackGroup: 'summon_attack_speed_aura' })
      for (const status of this.generalStatuses.filter((entry) => entry.ownerPlayerId === playerId
        && entry.sourceGeneralId === generalId
        && entry.expiresAtTick > this.currentTick && entry.statusId.startsWith('active_item_'))) {
        const stat = status.statusId.slice('active_item_'.length)
        if (stat === 'attack' || stat === 'attackSpeed') modifiers.push({
          source: { kind: 'passive_item', sourceId: status.instanceId }, target: { scope: 'self' },
          stat, operation: 'add_ratio', value: status.magnitude * status.stacks, stackGroup: status.stackGroup,
        })
      }
    }
    const player = this.players.get(playerId)
    const definition = this.getGeneralDefinition(generalId)
    for (const combat of player?.passiveItems?.combatEffects ?? []) {
      const effect = combat.effect
      if (effect.type !== 'persistent_stat_modifier') continue
      const applies = effect.target === 'target_general'
        || (effect.target === 'owner_physical_generals' && definition?.archetype === 'physical')
        || (effect.target === 'owner_magic_generals' && definition?.archetype === 'magic')
        || (effect.target === 'owner_control_generals' && definition?.archetype === 'control')
      if (applies && effect.stat === 'attack') modifiers.push({ source: { kind: 'passive_item', sourceId: combat.sourceKey },
        target: { scope: 'self' }, stat: 'attack', operation: 'add_ratio', value: effect.valueBps,
        stackGroup: effect.stackGroup })
    }
    for (const source of this.weaponSources(playerId, generalId)) {
      for (const modifier of source.statModifiers) {
        if (modifier.target !== 'owner_general') continue
        const stat = modifier.stat === 'attack' ? 'attack'
          : modifier.stat === 'attack_speed' ? 'attackSpeed'
            : modifier.stat === 'attack_range' ? 'attackRange'
              : modifier.stat === 'crit_damage' ? 'critDamage' : null
        if (stat) modifiers.push({ source: { kind: 'weapon', sourceId: `${source.sourceKey}:${modifier.effectId}` },
          target: { scope: 'self' }, stat, operation: modifier.operation, value: modifier.value,
          stackGroup: `${source.sourceKey}:${modifier.effectId}`,
          ...(modifier.conditionTagsAny ? { condition: { targetTagsAny: modifier.conditionTagsAny } } : {}) })
      }
    }
    for (const sourceFormation of this.generalFormations.getActiveFormations(playerId)) {
      if (sourceFormation.generalId === generalId) continue
      const sourceDefinition = this.getGeneralDefinition(sourceFormation.generalId)
      if (!sourceDefinition) continue
      for (const effect of sourceDefinition.passiveSkill.effects) {
        if (effect.target.scope !== 'owner_generals') continue
        if (effect.condition?.targetTagsAny
          && !effect.condition.targetTagsAny.some((tag) => targetTags.includes(tag))) continue
        modifiers.push({ ...effect, source: { ...effect.source } })
      }
    }
    return modifiers
  }

  private weaponSources(playerId: string, generalId: string): readonly WeaponProjectionSource[] {
    const snapshot = this.players.get(playerId)?.weaponSnapshot
    return snapshot ? projectWeaponLoadout(this.seed, snapshot, generalId) : []
  }

  private emitUnsupportedWeaponEffectOnce(
    playerId: string,
    generalId: string,
    source: WeaponProjectionSource,
    triggerId: string,
    actionType: string,
  ): void {
    const key = `${source.sourceKey}:${triggerId}:${actionType}`
    if (this.reportedUnsupportedWeaponEffects.has(key)) return
    this.reportedUnsupportedWeaponEffects.add(key)
    this.emit('WEAPON_EFFECT_UNSUPPORTED', { playerId, generalId, weaponId: source.weaponId,
      sourceKey: source.sourceKey, triggerId, actionType })
  }

  private weaponStatRatio(playerId: string, generalId: string, stat: WeaponStat, targetTags: readonly string[] = []): number {
    let ratio = 10000
    let flat = 0
    for (const source of this.weaponSources(playerId, generalId)) {
      for (const modifier of source.statModifiers) {
        if (modifier.stat !== stat || modifier.target !== 'owner_general') continue
        if (modifier.conditionTagsAny && !modifier.conditionTagsAny.some((tag) => targetTags.includes(tag))) continue
        if (modifier.operation === 'add_ratio') ratio += modifier.value
        else flat += modifier.value
      }
    }
    return ratio + flat
  }

  private activeItemTimedRatio(playerId: string, generalId: string, stat: string): number {
    return this.generalStatuses.filter((entry) => entry.ownerPlayerId === playerId
      && entry.sourceGeneralId === generalId && entry.statusId === `active_item_${stat}`
      && entry.expiresAtTick > this.currentTick)
      .reduce((sum, entry) => sum + entry.magnitude * entry.stacks, 0)
  }

  private passiveCombatRatio(player: PlayerRuntime, generalId: string,
    stat: 'magicDamage' | 'summonDamage' | 'summonDuration' | 'controlDuration'): number {
    const definition = this.getGeneralDefinition(generalId)
    return (player.passiveItems?.combatEffects ?? []).reduce((sum, entry) => {
      const effect = entry.effect
      if (effect.type !== 'persistent_stat_modifier' || effect.stat !== stat) return sum
      const applies = (stat === 'summonDamage' || stat === 'summonDuration')
        ? effect.target === 'summons_owned_by_player'
        : effect.target === 'target_general'
          || (effect.target === 'owner_magic_generals' && definition?.archetype === 'magic')
          || (effect.target === 'owner_control_generals' && definition?.archetype === 'control')
      return applies ? sum + effect.valueBps : sum
    }, 0)
  }

  private weaponSummonModifier(playerId: string, generalId: string, stat: WeaponStat): { ratio: number; flat: number } {
    let ratio = 10000
    let flat = 0
    for (const source of this.weaponSources(playerId, generalId)) for (const modifier of source.statModifiers) {
      if (modifier.target !== 'owned_summons' || modifier.stat !== stat) continue
      if (modifier.operation === 'add_ratio') ratio += modifier.value
      else flat += modifier.value
    }
    return { ratio, flat }
  }

  private summonAuraAttackSpeedRatio(ownerPlayerId: string, xMilli: number, yMilli: number): number {
    let ratio = 10000
    for (const summon of this.summonedUnits) {
      if (summon.ownerPlayerId !== ownerPlayerId || !summon.template.aura) continue
      if (this.distanceSquared(xMilli, yMilli, summon.xMilli, summon.yMilli)
        <= summon.template.aura.radiusMilliCells ** 2) ratio += summon.template.aura.valueBps
    }
    return ratio
  }

  private settleGeneralSynergyStat(input: {
    playerId: string
    generalId: string
    stat: SynergyStat
    baseValue: number
    targetTags?: readonly string[]
    effectTags?: readonly string[]
  }): number {
    const modifiers = this.synergyEffects.query({
      subject: { kind: 'general', ownerPlayerId: input.playerId, generalId: input.generalId },
      targetTags: input.targetTags,
      effectTags: input.effectTags,
    }).statModifiers
    return settleRuntimeSynergyStat({ baseValue: input.baseValue, stat: input.stat, modifiers })
  }

  private settleSummonSynergyStat(input: {
    ownerPlayerId: string
    sourceGeneralId: string
    summonUnitId: string
    stat: SynergyStat
    baseValue: number
  }): number {
    const modifiers = this.synergyEffects.query({ subject: { kind: 'summon',
      ownerPlayerId: input.ownerPlayerId, sourceGeneralId: input.sourceGeneralId,
      summonUnitId: input.summonUnitId } }).statModifiers
    return settleRuntimeSynergyStat({ baseValue: input.baseValue, stat: input.stat, modifiers })
  }

  private resolveSynergyEffectParameter(
    ownerPlayerId: string,
    sourceGeneralId: string,
    targetEffectId: string,
    parameter: string,
    baseValue: number,
  ): number {
    const patches = this.synergyEffects.query({
      subject: { kind: 'general', ownerPlayerId, generalId: sourceGeneralId },
      targetEffectId,
    }).parameterPatches
    return settleRuntimeSynergyParameter({ baseValue, parameter, patches })
  }

  private definitionWithSynergyCooldown(playerId: string, definition: GeneralDefinition): GeneralDefinition {
    const reduction = this.settleGeneralSynergyStat({
      playerId,
      generalId: definition.generalId,
      stat: 'cooldownReduction',
      baseValue: 10000,
    }) - 10000 + Math.max(0, this.weaponStatRatio(playerId, definition.generalId, 'cooldown_reduction') - 10000)
    let ownerAuraRatio = 10000
    for (const formation of this.generalFormations.getActiveFormations(playerId)) {
      const source = this.getGeneralDefinition(formation.generalId)
      const progress = this.generalFormations.getProgress(playerId, formation.generalId)
      if (!source || !progress) continue
      for (const effect of source.passiveSkill.structuredEffects ?? []) {
        if (effect.type !== 'cooldown_modify' || !effect.tags.includes('owner_aura')
          || (effect.targetSkill !== 'active_skill' && effect.targetSkill !== 'all_skills')) continue
        const value = getGeneralLevelValue(effect.valueByLevel, progress.level)
        if (effect.operation === 'add_ratio') ownerAuraRatio = Math.max(0,
          Math.floor(ownerAuraRatio * (10000 + value) / 10000))
      }
    }
    if (reduction === 0 && ownerAuraRatio === 10000) return definition
    const cooldownMsByLevel = definition.activeSkill.cooldownMsByLevel.map((base) => (
      Math.max(1, Math.floor(base * Math.max(0, 10000 - reduction) / 10000 * ownerAuraRatio / 10000))
    )) as unknown as GeneralDefinition['activeSkill']['cooldownMsByLevel']
    return { ...definition, activeSkill: { ...definition.activeSkill, cooldownMsByLevel } }
  }

  private playerSnapshot(player: PlayerRuntime): PvePlayerSnapshot {
    const remainingCharacterTokens: Record<string, number> = {}
    for (const [glyph, count] of [...player.remainingCharacterTokens.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      remainingCharacterTokens[glyph] = count
    }
    const boardPieces: PveBoardPiece[] = [...player.board.values()]
      .sort((left, right) => left.y - right.y || left.x - right.x || left.piece.id.localeCompare(right.piece.id))
      .map((entry) => ({ x: entry.x, y: entry.y, piece: clonePiece(entry.piece) }))
    const generalFormations = this.generalFormations.getActiveFormations(player.playerId).map((formation) => {
      const definition = this.getGeneralDefinition(formation.generalId)
      return {
        formationId: formation.formationId,
        generalId: formation.generalId,
        name: definition?.name ?? formation.generalId,
        characterPieceIds: [...formation.characterTokenIds],
        cells: formation.cells.map((cell) => ({ ...cell })),
        anchorXMilli: formation.anchorMilli.x,
        anchorYMilli: formation.anchorMilli.y,
        fixed: formation.fixed,
      }
    })
    const generalProgress = this.generalFormations.getAllProgress(player.playerId).flatMap((progress) => {
      const definition = this.getGeneralDefinition(progress.generalId)
      if (!definition) return []
      const experienceToNextLevel = progress.level >= progress.maxLevel
        ? null
        : Math.max(0, cumulativeExperienceRequiredForLevel(
            definition,
            (progress.level + 1) as 2 | 3 | 4 | 5,
          ) - progress.experiencePoints)
      const stats = resolveGeneralStats(
        definition,
        progress.level,
        this.generalSynergyModifiers(player.playerId, progress.generalId),
      )
      return [{
        generalId: progress.generalId,
        name: definition.name,
        quality: definition.quality,
        archetype: definition.archetype,
        level: progress.level,
        maxLevel: progress.maxLevel,
        experiencePoints: progress.experiencePoints,
        experienceToNextLevel,
        nextBasicAttackTick: progress.nextBasicAttackTick,
        activeSkillReadyAtTick: progress.activeSkillReadyAtTick,
        basicAttackCount: progress.basicAttackCount ?? 0,
        nextPassiveTriggerTick: progress.nextPassiveTriggerTick ?? 0,
        activeSkillName: definition.activeSkill.skillName,
        attack: stats.attack,
        attackIntervalMs: stats.attackIntervalMs,
        attackRangeMilliCells: stats.attackRangeMilliCells,
        critChanceBps: stats.critChanceBps,
        critDamageBps: stats.critDamageBps,
        activeSkillCooldownMs: getGeneralLevelValue(
          definition.activeSkill.cooldownMsByLevel,
          progress.level,
        ),
        activeStatuses: this.generalStatuses
          .filter((status) => status.ownerPlayerId === player.playerId && status.sourceGeneralId === progress.generalId
            && status.expiresAtTick > this.currentTick)
          .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
          .map((status) => ({ ...status })),
      }]
    })
    const activeSynergies = (this.synergyByPlayer.get(player.playerId)?.activeSynergies ?? []).map((synergy) => ({
      synergyId: synergy.synergyId,
      name: SYNERGY_V1_CATALOG.find((definition) => definition.synergyId === synergy.synergyId)?.displayName
        ?? synergy.synergyId,
      level: synergy.level,
      contributingGeneralIds: [...synergy.contributingGeneralIds],
    }))
    return {
      playerId: player.playerId,
      slot: player.slot,
      rice: player.rice,
      recruitCount: player.recruitCount,
      nextRecruitCost: this.nextRecruitCost(player),
      populationUsed: this.populationUsed(player),
      populationCap: player.populationCap,
      trayRevision: player.trayRevision,
      reserveRevision: player.reserveRevision,
      boardRevision: player.boardRevision,
      tray: player.tray.map((piece) => piece ? clonePiece(piece) : null),
      reserve: player.reserve.map((piece) => piece ? clonePiece(piece) : null),
      discardedCharacters: player.discardedCharacters.map((piece) => ({ ...piece })),
      itemRuntime: player.itemRuntime ? {
        version: player.itemRuntime.version,
        slots: player.itemRuntime.slots.map((slot) => slot ? { ...slot } : null),
      } : null,
      weaponLoadoutByGeneralId: Object.fromEntries(Object.entries(player.weaponSnapshot?.byGeneralId ?? {})
        .map(([generalId, loadout]) => [generalId, [...loadout.slots] as [string | null, string | null]])),
      boardPieces,
      generalFormations,
      generalProgress,
      activeSynergies,
      remainingCharacterTokens,
      clearedWaves: [...player.clearedWaves].sort((left, right) => left - right),
      unlockedGeneralIds: [...player.unlockedGeneralIds],
      selectedGeneralIds: [...player.selectedGeneralIds],
    }
  }

  private nextRecruitCost(player: PlayerRuntime): number {
    const baseCost = resolvePvePaidRecruitBaseCost(player.recruitCount)
    return player.passiveItems ? resolvePaidRecruitCost(baseCost, player.passiveItems) : baseCost
  }

  private populationUsed(player: PlayerRuntime): number {
    let used = 0
    for (const entry of player.board.values()) {
      if (isSoldier(entry.piece)) {
        used += 1
      }
    }
    return used + this.generalFormations.getActiveFormations(player.playerId).length
  }

  private cloneBoard(board: Map<string, BoardEntry>): Map<string, BoardEntry> {
    return new Map([...board.entries()].map(([key, entry]) => [key, {
      x: entry.x,
      y: entry.y,
      piece: entry.piece,
    }]))
  }

  private isPieceInFixedFormation(playerId: string, pieceId: string): boolean {
    return this.generalFormations.getActiveFormations(playerId).some((formation) => (
      formation.fixed && formation.characterTokenIds.includes(pieceId)
    ))
  }

  private findBoardEntryByPieceId(player: PlayerRuntime, pieceId: string): BoardEntry | null {
    for (const entry of player.board.values()) {
      if (entry.piece.id === pieceId) {
        return entry
      }
    }
    return null
  }

  private findPiece(player: PlayerRuntime, pieceId: string): { piece: PvePiece, location: PieceLocation } | null {
    const trayIndex = player.tray.findIndex((piece) => piece?.id === pieceId)
    if (trayIndex >= 0) {
      const piece = player.tray[trayIndex]
      return piece ? { piece, location: { kind: 'tray', trayIndex } } : null
    }
    const reserveIndex = player.reserve.findIndex((piece) => piece?.id === pieceId)
    if (reserveIndex >= 0) {
      const piece = player.reserve[reserveIndex]
      return piece ? { piece, location: { kind: 'reserve', reserveIndex } } : null
    }
    for (const [key, entry] of player.board.entries()) {
      if (entry.piece.id === pieceId) {
        return {
          piece: entry.piece,
          location: { kind: 'board', boardKey: key, boardX: entry.x, boardY: entry.y },
        }
      }
    }
    return null
  }

  private removePieceAt(player: PlayerRuntime, location: PieceLocation): void {
    if (location.kind === 'tray' && location.trayIndex !== undefined) {
      player.tray[location.trayIndex] = null
    }
    else if (location.kind === 'reserve' && location.reserveIndex !== undefined) {
      player.reserve[location.reserveIndex] = null
    }
    else if (location.kind === 'board' && location.boardKey) {
      player.board.delete(location.boardKey)
    }
  }

  private putPieceAt(player: PlayerRuntime, location: PieceLocation, piece: PvePiece): void {
    if (location.kind === 'tray' && location.trayIndex !== undefined) {
      player.tray[location.trayIndex] = piece
    }
    else if (location.kind === 'reserve' && location.reserveIndex !== undefined) {
      player.reserve[location.reserveIndex] = piece
    }
    else if (
      location.kind === 'board'
      && location.boardKey
      && location.boardX !== undefined
      && location.boardY !== undefined
    ) {
      player.board.set(location.boardKey, { x: location.boardX, y: location.boardY, piece })
    }
    else {
      throw new Error('Invalid piece target location')
    }
  }

  private resetAttackCooldown(piece: PvePiece): void {
    if (isSoldier(piece)) {
      piece.nextAttackTick = this.currentTick + this.attackIntervalTicks(piece)
    }
  }

  private attackIntervalTicks(piece: SoldierPiece): number {
    const definition = getSoldierCatalogEntry(piece.soldierType)
    return Math.ceil(getSoldierLevelValue(definition.attackIntervalMsByLevel, piece.level) / this.tickRateMs)
  }

  private compareEnemyPriority(left: EnemyRuntime, right: EnemyRuntime): number {
    return right.lapCount - left.lapCount
      || right.pathProgressMilli - left.pathProgressMilli
      || left.spawnSequence - right.spawnSequence
      || left.id.localeCompare(right.id)
  }

  private distanceSquared(leftX: number, leftY: number, rightX: number, rightY: number): number {
    const deltaX = rightX - leftX
    const deltaY = rightY - leftY
    return deltaX * deltaX + deltaY * deltaY
  }

  private validateRevisions(
    player: PlayerRuntime,
    expectedTrayRevision?: number,
    expectedBoardRevision?: number,
    expectedReserveRevision?: number,
  ): string | null {
    if (!this.revisionMatches(expectedTrayRevision, player.trayRevision)) {
      return 'STALE_TRAY_REVISION'
    }
    if (!this.revisionMatches(expectedBoardRevision, player.boardRevision)) {
      return 'STALE_BOARD_REVISION'
    }
    if (!this.revisionMatches(expectedReserveRevision, player.reserveRevision)) {
      return 'STALE_RESERVE_REVISION'
    }
    return null
  }

  private revisionMatches(expected: number | undefined, actual: number): boolean {
    return expected === undefined || expected === actual
  }

  private isEnemyTargetable(enemy: Pick<PveEnemySnapshot, 'spawnProtected' | 'invulnerable'>): boolean {
    return !enemy.spawnProtected && !enemy.invulnerable
  }

  private getGeneralDefinition(generalId: string): GeneralDefinition | null {
    return this.generalCatalog[generalId] ?? null
  }

  private isGeneralActive(playerId: string, generalId: string): boolean {
    return this.generalFormations.getActiveFormations(playerId).some((formation) => formation.generalId === generalId)
  }

  private isFormationActive(playerId: string, generalId: string, formationId: string): boolean {
    return this.generalFormations.getActiveFormations(playerId).some((formation) => (
      formation.generalId === generalId && formation.formationId === formationId
    ))
  }

  private executePassivePlan(
    player: PlayerRuntime,
    formation: GeneralFormationState,
    level: 1 | 2 | 3 | 4 | 5,
    event: 'initialize' | 'basic_attack' | 'skill_hit' | 'displacement_success' | 'enemy_killed',
  ): void {
    const catalogDefinition = this.getGeneralDefinition(formation.generalId)
    const progress = this.generalFormations.getProgress(player.playerId, formation.generalId)
    if (!catalogDefinition || !progress) return
    const definition = this.definitionWithSynergyCooldown(player.playerId, catalogDefinition)
    const plan = planGeneralPassiveTrigger({ definition, formation, progress, currentTick: this.currentTick,
      tickRateMs: this.tickRateMs, event, modifiers: this.generalSynergyModifiers(player.playerId, formation.generalId),
      parameterResolver: (effectId, parameter, baseValue) => this.resolvePlanningEffectParameter(
        player.playerId, formation.generalId, formation.formationId, effectId, parameter, baseValue,
      ),
      enemies: this.enemies.map((enemy) => ({ id: enemy.id, xMilli: enemy.xMilli, yMilli: enemy.yMilli,
        currentHp: enemy.currentHp, pathProgressMilli: enemy.pathProgressMilli, spawnSequence: enemy.spawnSequence,
        targetable: enemy.lifecycle === 'alive' && this.isEnemyTargetable(enemy), tags: this.enemyTags(enemy) })) })
    this.generalFormations.replaceProgress({ ...progress, basicAttackCount: plan.nextBasicAttackCount,
      nextPassiveTriggerTick: plan.nextPassiveTriggerTick })
    const ownerAuraEffectIds = new Set((definition.passiveSkill.structuredEffects ?? [])
      .filter((effect) => effect.type === 'cooldown_modify' && effect.tags.includes('owner_aura'))
      .map((effect) => effect.effectId))
    for (const action of plan.actions) {
      if (!ownerAuraEffectIds.has(action.effectId)) this.executeGeneralCombatAction(player, formation, level, action)
    }
  }

  private getWaveDefinition(waveNumber: number): WaveMinionCatalogEntry | null {
    const definition = this.waveCatalog[waveNumber - 1] ?? null
    const stageGlyphPool = this.waveGlyphPools?.[waveNumber - 1]
    return definition && stageGlyphPool
      ? { ...definition, glyphPool: stageGlyphPool }
      : definition
  }

  private isStorageIndexValid(zone: 'tray' | 'reserve', index: number, player?: PlayerRuntime): boolean {
    const size = zone === 'tray' ? TRAY_SIZE : (player?.reserve.length ?? RESERVE_SIZE)
    return Number.isInteger(index) && index >= 0 && index < size
  }

  private discardStorageCharacters(player: PlayerRuntime, pieces: readonly (PvePiece | null)[]): void {
    for (const piece of pieces) {
      if (piece?.kind === 'character' && !player.discardedCharacters.some((entry) => entry.id === piece.id)) {
        player.discardedCharacters.push(piece)
      }
    }
  }

  private canDeployAt(slot: PveLaneSlot, x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && this.isDeployableCell(slot, x, y)
  }

  private commandResult(ok: boolean, code: string): PveRuntimeResult {
    return { ok, code, tick: this.currentTick }
  }

  private actionResult(
    action: PveRuntimeAction,
    ok: boolean,
    code: string,
    details?: Record<string, string | number | boolean | null>,
  ): PveRuntimeResult {
    return { ok, code, tick: this.currentTick, actionId: action.actionId, details }
  }

  private emit(
    type: PveRuntimeEvent['type'],
    data: PveRuntimeEvent['data'],
    choreography?: Pick<PveRuntimeEvent, 'actionId' | 'targetIds' | 'geometry'>,
  ): void {
    this.eventSequence += 1
    const event: PveRuntimeEvent = {
      id: `event-${this.eventSequence}`,
      tick: this.currentTick,
      type,
      data: structuredClone(data),
      ...(choreography?.actionId ? { actionId: choreography.actionId } : {}),
      ...(choreography?.targetIds ? { targetIds: [...new Set(choreography.targetIds)] } : {}),
      ...(choreography?.geometry !== undefined
        ? { geometry: choreography.geometry === null ? null : structuredClone(choreography.geometry) }
        : {}),
    }
    this.recentEvents.push(event)
    this.eventObserver?.(structuredClone(event))
    while (this.recentEvents.length > this.eventHistoryLimit) {
      this.recentEvents.shift()
    }
  }
}
