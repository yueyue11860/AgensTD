import {
  getSoldierCatalogEntry,
  getSoldierLevelValue,
  getWaveMinionCatalogEntry,
  SOLDIER_TYPES,
  validatePveV2Catalogs,
  type SoldierCatalogEntry,
  type WaveMinionCatalogEntry,
} from './catalogs'
import {
  createPveLaneRoutes,
  isDefaultDeployableCell,
  PVE_LANE_SLOTS,
} from './arena'
import { DeterministicPrng } from './prng'
import type {
  CharacterPiece,
  MergeSoldiersAction,
  MoveBoardPieceAction,
  PveBoardPiece,
  PveEnemySnapshot,
  PveGameRuntimeOptions,
  PveLaneRoute,
  PveLaneSlot,
  PvePiece,
  PvePlayerSnapshot,
  PveRuntimeAction,
  PveRuntimeEvent,
  PveRuntimeResult,
  PveRuntimeSnapshot,
  SoldierLevel,
  SoldierPiece,
  SwapTrayBoardAction,
} from './types'

const TRAY_SIZE = 5
const POPULATION_CAP = 10
const CHARACTER_BRANCH_BPS = 1000
const ENEMY_CAPACITY_PER_PLAYER = 10
const OVERLOAD_DURATION_MS = 10000
const XP_REWARD_POINTS = 1000

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
  boardRevision: number
  tray: Array<PvePiece | null>
  board: Map<string, BoardEntry>
  remainingCharacterTokens: Map<string, number>
  clearedWaves: Set<number>
}

interface EnemyRuntime extends PveEnemySnapshot {
  lifecycle: 'alive' | 'dead'
}

interface LaneWaveRuntime {
  playerId: string
  slot: PveLaneSlot
  spawnedCount: number
  totalCount: number
  nextSpawnTick: number
  clearRewardGranted: boolean
  retired: boolean
}

interface PieceLocation {
  kind: 'tray' | 'board'
  trayIndex?: number
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

function validateRuntimeOptions(options: PveGameRuntimeOptions): void {
  if (!Number.isInteger(options.tickRateMs ?? 100) || (options.tickRateMs ?? 100) <= 0) {
    throw new Error('tickRateMs must be a positive integer')
  }
  if (!Number.isInteger(options.prepDurationMs ?? 5000) || (options.prepDurationMs ?? 5000) < 0) {
    throw new Error('prepDurationMs must be a non-negative integer')
  }
  if (!Number.isInteger(options.maxWaves ?? 20) || (options.maxWaves ?? 20) < 1 || (options.maxWaves ?? 20) > 20) {
    throw new Error('maxWaves must be an integer between 1 and 20')
  }
}

export class PveGameRuntime {
  private readonly tickRateMs: number

  private readonly seed: string

  private readonly prng: DeterministicPrng

  private readonly prepDurationTicks: number

  private readonly maxWaves: number

  private readonly laneRoutes: Record<PveLaneSlot, PveLaneRoute>

  private readonly isDeployableCell: (slot: PveLaneSlot, x: number, y: number) => boolean

  private readonly initialCharacterTokens: Map<string, number>

  private readonly eventHistoryLimit: number

  private readonly players = new Map<string, PlayerRuntime>()

  private readonly slotAssignments = new Map<PveLaneSlot, string>()

  private readonly processedActions = new Map<string, PveRuntimeResult>()

  private readonly recentEvents: PveRuntimeEvent[] = []

  private enemies: EnemyRuntime[] = []

  private laneWaves: LaneWaveRuntime[] = []

  private currentTick = 0

  private status: PveRuntimeSnapshot['status'] = 'waiting'

  private result: PveRuntimeSnapshot['result'] = null

  private currentWaveNumber = 0

  private wavePhase: PveRuntimeSnapshot['wave']['phase'] = 'idle'

  private prepRemainingTicks = 0

  private playerCountAtStart = 0

  private enemyCapacity = 0

  private overloadTicks = 0

  private pieceSequence = 0

  private enemySequence = 0

  private eventSequence = 0

  constructor(options: PveGameRuntimeOptions) {
    validatePveV2Catalogs()
    validateRuntimeOptions(options)
    this.tickRateMs = options.tickRateMs ?? 100
    this.seed = String(options.seed)
    this.prng = new DeterministicPrng(options.seed)
    this.prepDurationTicks = Math.ceil((options.prepDurationMs ?? 5000) / this.tickRateMs)
    this.maxWaves = options.maxWaves ?? 20
    this.laneRoutes = createPveLaneRoutes(options.laneRoutes)
    this.isDeployableCell = options.isDeployableCell ?? isDefaultDeployableCell
    this.initialCharacterTokens = sanitizeCharacterTokens(options.characterTokens)
    this.eventHistoryLimit = Math.max(20, options.eventHistoryLimit ?? 300)
  }

  registerPlayer(playerId: string, slot: PveLaneSlot): PveRuntimeResult {
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

    const player: PlayerRuntime = {
      playerId,
      slot,
      rice: 10,
      recruitCount: 0,
      populationCap: POPULATION_CAP,
      trayRevision: 0,
      boardRevision: 0,
      tray: Array<PvePiece | null>(TRAY_SIZE).fill(null),
      board: new Map(),
      remainingCharacterTokens: new Map(this.initialCharacterTokens),
      clearedWaves: new Set(),
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
      const currentLane = this.laneWaves.find((lane) => lane.playerId === playerId && lane.slot === player.slot)
      if (currentLane) {
        currentLane.totalCount = currentLane.spawnedCount
        currentLane.retired = true
      }
    }
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
    this.prepareWave(1)
    this.emit('MATCH_STARTED', {
      playerCount: this.playerCountAtStart,
      enemyCapacity: this.enemyCapacity,
      seed: this.seed,
    })
    if (this.prepRemainingTicks === 0) {
      this.beginWaveSpawning()
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
        }
      }
    }

    this.processedActions.set(actionKey, result)
    return { ...result, details: result.details ? { ...result.details } : undefined }
  }

  tick(): PveRuntimeSnapshot {
    if (this.status !== 'running') {
      return this.snapshot()
    }

    this.currentTick += 1

    if (this.wavePhase === 'prep') {
      this.prepRemainingTicks = Math.max(0, this.prepRemainingTicks - 1)
      if (this.prepRemainingTicks === 0) {
        this.beginWaveSpawning()
      }
    }

    if (this.wavePhase === 'spawning' || this.wavePhase === 'clearing') {
      this.spawnDueEnemies()
      this.moveEnemies()
      this.resolveSoldierAttacks()
      this.enemies = this.enemies.filter((enemy) => enemy.lifecycle === 'alive')
      this.updateLaneClearRewards()
      this.updateWavePhaseAndProgression()
      this.evaluateOverload()
    }

    return this.snapshot()
  }

  snapshot(): PveRuntimeSnapshot {
    const overloadLimitTicks = Math.ceil(OVERLOAD_DURATION_MS / this.tickRateMs)
    const players = [...this.players.values()]
      .sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot))
      .map((player) => this.playerSnapshot(player))

    return {
      schemaVersion: 2,
      tick: this.currentTick,
      tickRateMs: this.tickRateMs,
      seed: this.seed,
      rngState: this.prng.snapshot(),
      status: this.status,
      result: this.result ? { ...this.result } : null,
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
        lanes: this.laneWaves
          .slice()
          .sort((left, right) => slotOrder(left.slot) - slotOrder(right.slot))
          .map((lane) => ({
            playerId: lane.playerId,
            slot: lane.slot,
            spawnedCount: lane.spawnedCount,
            totalCount: lane.totalCount,
            cleared: lane.spawnedCount >= lane.totalCount && !this.hasAliveLaneEnemy(lane),
            clearRewardGranted: lane.clearRewardGranted,
            retired: lane.retired,
          })),
      },
      players,
      enemies: this.enemies
        .filter((enemy) => enemy.lifecycle === 'alive')
        .slice()
        .sort((left, right) => left.spawnSequence - right.spawnSequence)
        .map(({ lifecycle: _lifecycle, ...enemy }) => ({ ...enemy })),
      recentEvents: this.recentEvents.map((event) => ({
        ...event,
        data: structuredClone(event.data),
      })),
    }
  }

  private handleRecruit(player: PlayerRuntime, action: Extract<PveRuntimeAction, { type: 'RECRUIT_BATCH' }>): PveRuntimeResult {
    if (!this.revisionMatches(action.expectedTrayRevision, player.trayRevision)) {
      return this.actionResult(action, false, 'STALE_TRAY_REVISION')
    }
    const cost = this.nextRecruitCost(player)
    if (player.rice < cost) {
      return this.actionResult(action, false, 'INSUFFICIENT_RICE', { required: cost, available: player.rice })
    }

    const nextTray = Array.from({ length: TRAY_SIZE }, () => this.drawRecruitPiece(player))
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
    player.tray = nextTray
    player.trayRevision += 1
    this.emit('RECRUITED', {
      playerId: player.playerId,
      cost,
      recruitCount: player.recruitCount,
      nextRecruitCost: this.nextRecruitCost(player),
      firstBatchSoldierForced,
      pieceIds: nextTray.map((piece) => piece.id),
    })
    return this.actionResult(action, true, 'RECRUITED', {
      cost,
      nextRecruitCost: this.nextRecruitCost(player),
      firstBatchSoldierForced,
    })
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

    const nextPopulation = this.populationUsed(player)
      - (isSoldier(boardPiece) ? 1 : 0)
      + (isSoldier(trayPiece) ? 1 : 0)
    if (nextPopulation > player.populationCap) {
      return this.actionResult(action, false, 'POPULATION_LIMIT')
    }

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
    player.board.set(targetKey, { x: action.targetX, y: action.targetY, piece: source.piece })
    if (target) {
      player.board.set(sourceKey, { x: source.x, y: source.y, piece: target.piece })
    }
    else {
      player.board.delete(sourceKey)
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
    const revisionError = this.validateRevisions(player, action.expectedTrayRevision, action.expectedBoardRevision)
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

  private drawRecruitPiece(player: PlayerRuntime): PvePiece {
    const eligibleGlyphs = [...player.remainingCharacterTokens.entries()]
      .filter(([, count]) => count > 0)
      .map(([glyph]) => glyph)
      .sort((left, right) => left.localeCompare(right))

    if (eligibleGlyphs.length > 0 && this.prng.rollBps(CHARACTER_BRANCH_BPS)) {
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
    this.currentWaveNumber = waveNumber
    this.wavePhase = 'prep'
    this.prepRemainingTicks = this.prepDurationTicks
    this.laneWaves = []
  }

  private beginWaveSpawning(): void {
    const definition = getWaveMinionCatalogEntry(this.currentWaveNumber)
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
    this.laneWaves = activePlayers.map((player) => ({
      playerId: player.playerId,
      slot: player.slot,
      spawnedCount: 0,
      totalCount: definition.countPerPlayer,
      nextSpawnTick: this.currentTick,
      clearRewardGranted: false,
      retired: false,
    }))
    this.emit('WAVE_STARTED', {
      waveNumber: this.currentWaveNumber,
      laneCount: this.laneWaves.length,
      countPerLane: definition.countPerPlayer,
    })
  }

  private spawnDueEnemies(): void {
    if (this.wavePhase !== 'spawning') {
      return
    }
    const definition = getWaveMinionCatalogEntry(this.currentWaveNumber)
    if (!definition) {
      return
    }
    const intervalTicks = Math.max(1, Math.ceil(definition.spawnIntervalMs / this.tickRateMs))

    for (const lane of this.laneWaves) {
      while (lane.spawnedCount < lane.totalCount && this.currentTick >= lane.nextSpawnTick) {
        this.spawnEnemy(lane, definition)
        lane.spawnedCount += 1
        lane.nextSpawnTick += intervalTicks
      }
    }
    if (this.laneWaves.every((lane) => lane.spawnedCount >= lane.totalCount)) {
      this.wavePhase = 'clearing'
    }
  }

  private spawnEnemy(lane: LaneWaveRuntime, definition: WaveMinionCatalogEntry): void {
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
      lifecycle: 'alive',
    }
    this.enemies.push(enemy)
    this.emit('ENEMY_SPAWNED', {
      enemyId: enemy.id,
      glyph,
      waveNumber: definition.waveNumber,
      laneOwnerPlayerId: lane.playerId,
      laneSlot: lane.slot,
    })
  }

  private moveEnemies(): void {
    const distancePerTick = Math.floor(1000 * this.tickRateMs / 1000)
    for (const enemy of this.enemies) {
      if (enemy.lifecycle !== 'alive') {
        continue
      }
      this.moveEnemy(enemy, distancePerTick)
    }
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
      soldier.nextAttackTick = this.currentTick + this.attackIntervalTicks(soldier)
      this.emit('BASIC_ATTACK_STARTED', {
        attackerId: soldier.id,
        playerId: player.playerId,
        targetIds: targets.map((target) => target.id),
      })

      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex]
        if (target.lifecycle !== 'alive') {
          continue
        }
        this.applySoldierDamage(player, soldier, definition, target, targetIndex > 0)
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
      if (enemy.lifecycle !== 'alive') {
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
      if (enemy.lifecycle !== 'alive' || enemy.id === primary.id) {
        return false
      }
      if (this.distanceSquared(attackerX, attackerY, enemy.xMilli, enemy.yMilli) > range * range) {
        return false
      }
      if (definition.attackShape === 'radius') {
        const radius = getSoldierLevelValue(definition.radiusMilliCellsByLevel, level)
        return this.distanceSquared(primary.xMilli, primary.yMilli, enemy.xMilli, enemy.yMilli) <= radius * radius
      }
      return this.isOnPierceLine(attackerX, attackerY, primary, enemy)
    })
    candidates.sort((left, right) => this.compareEnemyPriority(left, right))
    return [primary, ...candidates.slice(0, maxTargets - 1)]
  }

  private isOnPierceLine(
    attackerX: number,
    attackerY: number,
    primary: EnemyRuntime,
    candidate: EnemyRuntime,
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
    const toleranceMilli = 500
    return cross * cross <= toleranceMilli * toleranceMilli * lineLengthSquared
  }

  private applySoldierDamage(
    player: PlayerRuntime,
    soldier: SoldierPiece,
    definition: SoldierCatalogEntry,
    target: EnemyRuntime,
    isSecondary: boolean,
  ): void {
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
    const finalDamage = Math.max(1, Math.floor(rawDamage * 100 / (100 + Math.max(0, target.armor))))
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
    })
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
    })
    if (!enemy.lastDamagePlayerId) {
      return
    }
    const killer = this.players.get(enemy.lastDamagePlayerId)
    if (killer) {
      killer.rice += 1
      this.emit('RICE_GRANTED', {
        playerId: killer.playerId,
        enemyId: enemy.id,
        amount: 1,
        reason: 'LAST_DAMAGE_KILL',
      })
      this.emit('GENERAL_XP_SETTLEMENT_AVAILABLE', {
        playerId: killer.playerId,
        enemyId: enemy.id,
        xpPoints: XP_REWARD_POINTS,
      })
    }
  }

  private updateLaneClearRewards(): void {
    for (const lane of this.laneWaves) {
      if (lane.retired || lane.clearRewardGranted || lane.spawnedCount < lane.totalCount || this.hasAliveLaneEnemy(lane)) {
        continue
      }
      lane.clearRewardGranted = true
      const owner = this.players.get(lane.playerId)
      if (!owner) {
        continue
      }
      const reward = 5 * this.currentWaveNumber
      owner.rice += reward
      owner.clearedWaves.add(this.currentWaveNumber)
      this.emit('LANE_WAVE_CLEARED', {
        playerId: owner.playerId,
        slot: owner.slot,
        waveNumber: this.currentWaveNumber,
        riceReward: reward,
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
    if (this.laneWaves.length === 0) {
      return
    }
    const allSpawned = this.laneWaves.every((lane) => lane.spawnedCount >= lane.totalCount)
    if (allSpawned) {
      this.wavePhase = 'clearing'
    }
    if (!allSpawned || this.enemies.some((enemy) => enemy.lifecycle === 'alive' && enemy.waveNumber === this.currentWaveNumber)) {
      return
    }

    if (this.currentWaveNumber >= this.maxWaves) {
      this.wavePhase = 'complete'
      this.finishMatch('victory', 'All configured waves cleared')
      return
    }
    this.prepareWave(this.currentWaveNumber + 1)
    if (this.prepRemainingTicks === 0) {
      this.beginWaveSpawning()
    }
  }

  private evaluateOverload(): void {
    if (this.status !== 'running' || this.enemyCapacity <= 0) {
      return
    }
    const aliveCount = this.enemies.filter((enemy) => enemy.lifecycle === 'alive').length
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
        && enemy.waveNumber === this.currentWaveNumber
        && enemy.laneOwnerPlayerId === lane.playerId
        && enemy.laneSlot === lane.slot
    })
  }

  private playerSnapshot(player: PlayerRuntime): PvePlayerSnapshot {
    const remainingCharacterTokens: Record<string, number> = {}
    for (const [glyph, count] of [...player.remainingCharacterTokens.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      remainingCharacterTokens[glyph] = count
    }
    const boardPieces: PveBoardPiece[] = [...player.board.values()]
      .sort((left, right) => left.y - right.y || left.x - right.x || left.piece.id.localeCompare(right.piece.id))
      .map((entry) => ({ x: entry.x, y: entry.y, piece: clonePiece(entry.piece) }))
    return {
      playerId: player.playerId,
      slot: player.slot,
      rice: player.rice,
      recruitCount: player.recruitCount,
      nextRecruitCost: this.nextRecruitCost(player),
      populationUsed: this.populationUsed(player),
      populationCap: player.populationCap,
      trayRevision: player.trayRevision,
      boardRevision: player.boardRevision,
      tray: player.tray.map((piece) => piece ? clonePiece(piece) : null),
      boardPieces,
      remainingCharacterTokens,
      clearedWaves: [...player.clearedWaves].sort((left, right) => left - right),
    }
  }

  private nextRecruitCost(player: PlayerRuntime): number {
    return 5 + 2 * player.recruitCount
  }

  private populationUsed(player: PlayerRuntime): number {
    let used = 0
    for (const entry of player.board.values()) {
      if (isSoldier(entry.piece)) {
        used += 1
      }
    }
    return used
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
    else if (location.kind === 'board' && location.boardKey) {
      player.board.delete(location.boardKey)
    }
  }

  private putPieceAt(player: PlayerRuntime, location: PieceLocation, piece: PvePiece): void {
    if (location.kind === 'tray' && location.trayIndex !== undefined) {
      player.tray[location.trayIndex] = piece
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
  ): string | null {
    if (!this.revisionMatches(expectedTrayRevision, player.trayRevision)) {
      return 'STALE_TRAY_REVISION'
    }
    if (!this.revisionMatches(expectedBoardRevision, player.boardRevision)) {
      return 'STALE_BOARD_REVISION'
    }
    return null
  }

  private revisionMatches(expected: number | undefined, actual: number): boolean {
    return expected === undefined || expected === actual
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

  private emit(type: PveRuntimeEvent['type'], data: PveRuntimeEvent['data']): void {
    this.eventSequence += 1
    this.recentEvents.push({
      id: `event-${this.eventSequence}`,
      tick: this.currentTick,
      type,
      data,
    })
    while (this.recentEvents.length > this.eventHistoryLimit) {
      this.recentEvents.shift()
    }
  }
}
