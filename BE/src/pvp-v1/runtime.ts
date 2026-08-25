import { createHash } from 'node:crypto'
import type {
  PvpAuthorityState,
  PvpCommandResult,
  PvpEnemyKind,
  PvpEnemyState,
  PvpMatchResult,
  PvpMode,
  PvpParticipantResult,
  PvpPressureQueueEntry,
  PvpRealtimeState,
  PvpResultReason,
  PvpLoadAckRequest,
  PvpDeployRequest,
  PvpMoveOrMergeRequest,
  PvpRecruitRequest,
  PvpRecruitState,
  PvpRuntimeEvent,
  PvpSide,
  PvpSideState,
} from '../../../shared/contracts/pvp'
import { DeterministicPrng } from '../pve-v2/prng'
import {
  DUAL_REALM_MAP,
  hasEnemyBodyFullyExitedPvpSpawnGate,
  isPvpDeployableCell,
} from './map'
import { PVP_SOLDIER_TYPES, PVP_V1_RULES_SNAPSHOT, pvpSoldier } from './catalog'

const SIDES: readonly PvpSide[] = ['A', 'B']
const CORE_HP = 10
const INITIAL_RATIONS = 10
const POPULATION_CAP = 10
const TRAY_SIZE = 5
const RESERVE_SIZE = 2
const ROUND_BASE_COUNT = 10
const ROUND_RATIONS = 5
const PRESSURE_COST = 5
const PRESSURE_QUEUE_LIMIT = 6
const PRESSURE_COOLDOWN_MS = 1000
const DISCONNECT_FORFEIT_MS = 60_000
const TRIBULATION_START_MS = 6 * 60_000
const CORE_DAMAGE_BONUS_START_MS = 8 * 60_000
const ONE_LEAK_DEFEAT_START_MS = 10 * 60_000
const HARD_TIMEOUT_MS = 12 * 60_000
const DEFAULT_LOAD_TIMEOUT_MS = 45_000
export const PVP_ASSETS_VERSION = 'pvp_assets_v1'

interface PendingSpawn {
  spawnId: string
  kind: PvpEnemyKind
  glyph: string
  roundNumber: number
  maxHp: number
  armor: number
  magicResistance: number
  moveSpeedMilliCellsPerSecond: number
  coreDamage: number
  queuedAtTick: number
  pressure: PvpPressureQueueEntry | null
}

interface RuntimeSide {
  state: PvpSideState
  spawnQueue: PendingSpawn[]
  lastSpawnedEnemyId: string | null
  lastPressureAtTick: number | null
  lastAttackAtTick: Map<string, number>
}

export interface PvpRuntimeOptions {
  matchId: string
  mode: PvpMode
  seed: string | number
  rulesetVersion: string
  tickRateMs?: number
  countdownMs?: number
  roundIntervalMs?: number
  eventHistoryLimit?: number
  loadTimeoutMs?: number
  disconnectForfeitMs?: number
  assetsVersion?: string
}

export interface PvpParticipantRegistration {
  playerId: string
  playerName: string
}

/**
 * 只允许战斗解析器在命中、减伤、暴击等权威结算全部完成后调用。
 * 网络层不得把客户端 payload 直接映射到本结构，客户端也不能提交伤害数值。
 */
export interface AuthoritativePvpDamageInput {
  eventId: string
  sourcePlayerId: string
  enemyId: string
  rawDamage: number
  resolvedDamage: number
}

function oppositeSide(side: PvpSide): PvpSide {
  return side === 'A' ? 'B' : 'A'
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export class PvpMatchRuntime {
  private readonly matchId: string
  private readonly mode: PvpMode
  private readonly seed: string
  private readonly rulesetVersion: string
  private readonly tickRateMs: number
  private readonly countdownTicks: number
  private readonly roundIntervalTicks: number
  private readonly eventHistoryLimit: number
  private readonly loadTimeoutTicks: number
  private readonly assetsVersion: string
  private readonly rulesSnapshot = structuredClone(PVP_V1_RULES_SNAPSHOT)
  private readonly disconnectForfeitTicks: number
  private readonly prng: DeterministicPrng
  private readonly sides: Record<PvpSide, RuntimeSide | null> = { A: null, B: null }
  private readonly commandReceipts = new Map<string, { fingerprint: string, result: PvpCommandResult }>()
  private readonly recentEvents: PvpRuntimeEvent[] = []

  private phase: PvpAuthorityState['phase'] = 'created'
  private currentTick = 0
  private countdownRemainingTicks = 0
  private loadDeadlineAtTick: number | null = null
  private roundNumber = 0
  private nextRoundAtTick: number | null = null
  private playingStartedAtTick: number | null = null
  private result: PvpMatchResult | null = null
  private eventSequence = 0
  private enemySequence = 0
  private pressureSequence = 0
  private spawnSequence = 0
  private unitSequence = 0

  constructor(options: PvpRuntimeOptions) {
    if (!options.matchId.trim()) throw new Error('PVP_MATCH_ID_REQUIRED')
    if (!options.rulesetVersion.trim()) throw new Error('PVP_RULESET_VERSION_REQUIRED')
    this.matchId = options.matchId
    this.mode = options.mode
    this.seed = String(options.seed)
    this.rulesetVersion = options.rulesetVersion
    this.tickRateMs = Math.max(10, Math.floor(options.tickRateMs ?? 100))
    this.countdownTicks = Math.max(0, Math.ceil((options.countdownMs ?? 5000) / this.tickRateMs))
    this.roundIntervalTicks = Math.max(1, Math.ceil((options.roundIntervalMs ?? 20_000) / this.tickRateMs))
    this.eventHistoryLimit = Math.max(20, Math.floor(options.eventHistoryLimit ?? 500))
    this.loadTimeoutTicks = Math.max(1, Math.ceil((options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS) / this.tickRateMs))
    this.disconnectForfeitTicks = Math.max(1, Math.ceil((options.disconnectForfeitMs ?? DISCONNECT_FORFEIT_MS) / this.tickRateMs))
    this.assetsVersion = options.assetsVersion ?? PVP_ASSETS_VERSION
    this.prng = new DeterministicPrng(`${this.seed}:pvp-runtime`)
    this.transitionTo('waiting_players')
  }

  registerParticipant(side: PvpSide, participant: PvpParticipantRegistration, confirmedReady = false): PvpCommandResult {
    if (this.phase !== 'waiting_players') return this.command(false, 'WRONG_PHASE')
    if (!participant.playerId.trim() || !participant.playerName.trim()) return this.command(false, 'INVALID_PARTICIPANT')
    if (this.findSideByPlayerId(participant.playerId)) return this.command(false, 'PLAYER_ALREADY_REGISTERED')
    if (this.sides[side]) return this.command(false, 'SIDE_OCCUPIED')
    const stats = {
      playerId: participant.playerId,
      side,
      result: null,
      coreHpRemaining: CORE_HP,
      baseKills: 0,
      pressureKills: 0,
      leaks: 0,
      scriptureEarned: 0,
      scriptureSpent: 0,
      pressureSent: 0,
      pressureLeaked: 0,
      coreDamageDealt: 0,
      rationsEarned: 0,
      rationsSpent: 0,
      paidRecruitCount: 0,
      activeGeneralIds: [],
      peakPopulation: 0,
      highestSoldierLevel: 0,
      damageDealt: 0,
      controlDurationMs: 0,
    }
    this.sides[side] = {
      state: {
        side,
        playerId: participant.playerId,
        playerName: participant.playerName,
        connected: true,
        disconnectedAtTick: null,
        ready: confirmedReady,
        loaded: false,
        loadStatus: 'idle',
        loadFailureCode: null,
        loadAcknowledgedAtTick: null,
        coreHp: CORE_HP,
        coreMaxHp: CORE_HP,
        rations: INITIAL_RATIONS,
        scripture: 0,
        populationUsed: 0,
        populationCap: POPULATION_CAP,
        boardPieces: [],
        enemies: [],
        stats,
        privateState: {
          tray: Array<PvpRecruitState | null>(TRAY_SIZE).fill(null),
          reserve: Array<PvpRecruitState | null>(RESERVE_SIZE).fill(null),
          pendingPressure: [],
          trayRevision: 0,
          reserveRevision: 0,
          boardRevision: 0,
        },
      },
      spawnQueue: [],
      lastSpawnedEnemyId: null,
      lastPressureAtTick: null,
      lastAttackAtTick: new Map(),
    }
    if (this.sides.A && this.sides.B) {
      this.transitionTo('ready_check')
      if (this.sides.A.state.ready && this.sides.B.state.ready) this.enterLoading()
    }
    return this.command(true, 'PARTICIPANT_REGISTERED')
  }

  setReady(playerId: string, ready = true): PvpCommandResult {
    if (this.phase !== 'ready_check') return this.command(false, 'WRONG_PHASE')
    const side = this.requirePlayerSide(playerId)
    if (!side) return this.command(false, 'PLAYER_NOT_FOUND')
    this.sides[side]!.state.ready = ready
    if (this.sides.A?.state.ready && this.sides.B?.state.ready) this.enterLoading()
    return this.command(true, 'READY_STATE_UPDATED')
  }

  markLoaded(playerId: string): PvpCommandResult {
    return this.acknowledgeLoad(playerId, {
      requestId: `legacy-loaded:${playerId}`,
      rulesetVersion: this.rulesetVersion,
      mapId: DUAL_REALM_MAP.mapId,
      mapVersion: DUAL_REALM_MAP.mapVersion,
      routeHash: DUAL_REALM_MAP.routeHash,
      assetsVersion: this.assetsVersion,
      status: 'loaded',
    })
  }

  acknowledgeLoad(playerId: string, input: PvpLoadAckRequest): PvpCommandResult {
    return this.idempotent(playerId, input.requestId, 'load_ack', { ...input }, () => {
      if (this.phase !== 'loading') return this.command(false, 'WRONG_PHASE', input.requestId)
      const side = this.requirePlayerSide(playerId)
      if (!side) return this.command(false, 'PLAYER_NOT_FOUND', input.requestId)
      if (input.rulesetVersion !== this.rulesetVersion || input.mapId !== DUAL_REALM_MAP.mapId
        || input.mapVersion !== DUAL_REALM_MAP.mapVersion || input.routeHash !== DUAL_REALM_MAP.routeHash
        || input.assetsVersion !== this.assetsVersion) {
        return this.command(false, 'LOAD_VERSION_MISMATCH', input.requestId)
      }
      const state = this.sides[side]!.state
      state.loadAcknowledgedAtTick = this.currentTick
      if (input.status === 'failed') {
        state.loadStatus = 'failed'
        state.loadFailureCode = (input.failureCode?.trim() || 'CLIENT_LOAD_FAILED').slice(0, 120)
        this.emit('LOAD_ACK_UPDATED', { playerId, side, status: 'failed', failureCode: state.loadFailureCode })
        this.voidMatch('load_failed')
        return this.command(true, 'PLAYER_LOAD_FAILED', input.requestId)
      }
      state.loaded = true
      state.loadStatus = 'loaded'
      state.loadFailureCode = null
      this.emit('LOAD_ACK_UPDATED', { playerId, side, status: 'loaded' })
      if (this.sides.A?.state.loaded && this.sides.B?.state.loaded) {
        this.loadDeadlineAtTick = null
        this.countdownRemainingTicks = this.countdownTicks
        this.transitionTo('countdown')
        if (this.countdownRemainingTicks === 0) this.beginPlaying()
      }
      return this.command(true, 'PLAYER_LOADED', input.requestId)
    })
  }

  recruit(playerId: string, input: PvpRecruitRequest): PvpCommandResult {
    return this.idempotent(playerId, input.requestId, 'recruit', { expectedTrayRevision: input.expectedTrayRevision }, () => {
      if (this.phase !== 'playing') return this.command(false, 'WRONG_PHASE', input.requestId)
      const side = this.requirePlayerSide(playerId)
      if (!side) return this.command(false, 'PLAYER_NOT_FOUND', input.requestId)
      const runtime = this.sides[side]!
      const privateState = runtime.state.privateState
      if (input.expectedTrayRevision !== privateState.trayRevision) {
        return this.command(false, 'TRAY_REVISION_CONFLICT', input.requestId, { currentTrayRevision: privateState.trayRevision })
      }
      const trayIndex = privateState.tray.findIndex((unit) => unit === null)
      const reserveIndex = trayIndex < 0 ? privateState.reserve.findIndex((unit) => unit === null) : -1
      if (trayIndex < 0 && reserveIndex < 0) return this.command(false, 'RECRUIT_STORAGE_FULL', input.requestId)
      const cost = this.rulesSnapshot.recruitCost
      if (runtime.state.rations < cost) return this.command(false, 'INSUFFICIENT_RATIONS', input.requestId)
      const soldierType = PVP_SOLDIER_TYPES[this.prng.nextInt(PVP_SOLDIER_TYPES.length)]!
      const definition = pvpSoldier(soldierType)
      this.unitSequence += 1
      const unit = { unitId: `pvp-unit-${this.unitSequence}`, soldierType, glyph: definition.glyph, level: 1 as const }
      if (trayIndex >= 0) privateState.tray[trayIndex] = unit
      else privateState.reserve[reserveIndex] = unit
      runtime.state.rations -= cost
      runtime.state.stats.rationsSpent += cost
      runtime.state.stats.paidRecruitCount += 1
      privateState.trayRevision += 1
      this.emit('PIECE_RECRUITED', { playerId, side, unitId: unit.unitId, soldierType, glyph: unit.glyph })
      return this.command(true, 'PIECE_RECRUITED', input.requestId, {
        unitId: unit.unitId, soldierType, glyph: unit.glyph, trayRevision: privateState.trayRevision,
      })
    })
  }

  deploy(playerId: string, input: PvpDeployRequest): PvpCommandResult {
    return this.idempotent(playerId, input.requestId, 'deploy', { ...input }, () => {
      if (this.phase !== 'playing') return this.command(false, 'WRONG_PHASE', input.requestId)
      const side = this.requirePlayerSide(playerId)
      if (!side) return this.command(false, 'PLAYER_NOT_FOUND', input.requestId)
      const runtime = this.sides[side]!
      const state = runtime.state
      if (input.expectedTrayRevision !== state.privateState.trayRevision) return this.command(false, 'TRAY_REVISION_CONFLICT', input.requestId, { currentTrayRevision: state.privateState.trayRevision })
      if (input.expectedBoardRevision !== state.privateState.boardRevision) return this.command(false, 'BOARD_REVISION_CONFLICT', input.requestId, { currentBoardRevision: state.privateState.boardRevision })
      if (state.populationUsed >= state.populationCap) return this.command(false, 'POPULATION_CAP_REACHED', input.requestId)
      if (!this.isStandardDeploymentSlot(side, input.x, input.y) || !isPvpDeployableCell(side, input.x, input.y)) return this.command(false, 'CELL_NOT_DEPLOYABLE', input.requestId)
      if (state.boardPieces.some((piece) => piece.x === input.x && piece.y === input.y)) return this.command(false, 'CELL_OCCUPIED', input.requestId)
      const located = this.findRecruit(runtime, input.unitId)
      if (!located) return this.command(false, 'UNIT_NOT_IN_PRIVATE_STORAGE', input.requestId)
      located.collection[located.index] = null
      state.boardPieces.push({
        entityId: located.unit.unitId, ownerPlayerId: playerId, kind: 'soldier', glyph: located.unit.glyph,
        soldierType: located.unit.soldierType, level: 1, x: input.x, y: input.y,
      })
      state.populationUsed += 1
      state.stats.peakPopulation = Math.max(state.stats.peakPopulation, state.populationUsed)
      state.stats.highestSoldierLevel = Math.max(state.stats.highestSoldierLevel, 1)
      state.privateState.trayRevision += 1
      state.privateState.boardRevision += 1
      this.emit('PIECE_DEPLOYED', { playerId, side, entityId: located.unit.unitId, soldierType: located.unit.soldierType, glyph: located.unit.glyph, x: input.x, y: input.y, boardRevision: state.privateState.boardRevision })
      return this.command(true, 'PIECE_DEPLOYED', input.requestId, { entityId: located.unit.unitId, trayRevision: state.privateState.trayRevision, boardRevision: state.privateState.boardRevision })
    })
  }

  moveOrMerge(playerId: string, input: PvpMoveOrMergeRequest): PvpCommandResult {
    return this.idempotent(playerId, input.requestId, 'move_or_merge', { ...input }, () => {
      if (this.phase !== 'playing') return this.command(false, 'WRONG_PHASE', input.requestId)
      const side = this.requirePlayerSide(playerId)
      if (!side) return this.command(false, 'PLAYER_NOT_FOUND', input.requestId)
      const runtime = this.sides[side]!
      const state = runtime.state
      if (input.expectedBoardRevision !== state.privateState.boardRevision) return this.command(false, 'BOARD_REVISION_CONFLICT', input.requestId, { currentBoardRevision: state.privateState.boardRevision })
      if (!this.isStandardDeploymentSlot(side, input.x, input.y) || !isPvpDeployableCell(side, input.x, input.y)) return this.command(false, 'CELL_NOT_DEPLOYABLE', input.requestId)
      const sourceIndex = state.boardPieces.findIndex((piece) => piece.entityId === input.entityId && piece.ownerPlayerId === playerId)
      if (sourceIndex < 0) return this.command(false, 'PIECE_NOT_OWNED', input.requestId)
      const source = state.boardPieces[sourceIndex]!
      if (source.x === input.x && source.y === input.y) return this.command(false, 'PIECE_ALREADY_AT_CELL', input.requestId)
      const targetIndex = state.boardPieces.findIndex((piece) => piece.x === input.x && piece.y === input.y)
      if (targetIndex < 0) {
        source.x = input.x
        source.y = input.y
        state.privateState.boardRevision += 1
        this.emit('PIECE_MOVED', { playerId, side, entityId: source.entityId, x: input.x, y: input.y, boardRevision: state.privateState.boardRevision })
        return this.command(true, 'PIECE_MOVED', input.requestId, { entityId: source.entityId, boardRevision: state.privateState.boardRevision })
      }
      const target = state.boardPieces[targetIndex]!
      if (target.ownerPlayerId !== playerId || target.kind !== 'soldier' || source.kind !== 'soldier'
        || target.soldierType !== source.soldierType || target.level !== source.level) return this.command(false, 'MERGE_INCOMPATIBLE', input.requestId)
      if ((target.level ?? 1) >= this.rulesSnapshot.maxMergeLevel) return this.command(false, 'MERGE_LEVEL_CAP', input.requestId)
      target.level = ((target.level ?? 1) + 1) as 2 | 3
      state.boardPieces.splice(sourceIndex, 1)
      state.populationUsed = Math.max(0, state.populationUsed - 1)
      state.stats.highestSoldierLevel = Math.max(state.stats.highestSoldierLevel, target.level)
      runtime.lastAttackAtTick.delete(source.entityId)
      state.privateState.boardRevision += 1
      this.emit('PIECE_MERGED', { playerId, side, consumedEntityId: source.entityId, entityId: target.entityId, soldierType: target.soldierType ?? null, level: target.level, x: target.x, y: target.y, boardRevision: state.privateState.boardRevision })
      return this.command(true, 'PIECE_MERGED', input.requestId, { entityId: target.entityId, level: target.level, boardRevision: state.privateState.boardRevision })
    })
  }

  tick(): PvpAuthorityState {
    if (this.phase === 'completed' || this.phase === 'voided' || this.phase === 'settling') return this.snapshot()
    this.currentTick += 1
    if (this.phase === 'countdown') {
      this.countdownRemainingTicks = Math.max(0, this.countdownRemainingTicks - 1)
      if (this.countdownRemainingTicks === 0) this.beginPlaying()
      return this.snapshot()
    }
    if (this.phase === 'loading') {
      if (this.loadDeadlineAtTick !== null && this.currentTick >= this.loadDeadlineAtTick) {
        const disconnected = SIDES.some(side => this.sides[side]?.state.connected === false)
        this.voidMatch(disconnected ? 'load_disconnect' : 'load_timeout')
      }
      return this.snapshot()
    }
    if (this.phase !== 'playing') return this.snapshot()

    this.updateTribulation()
    this.evaluateDisconnectForfeits()
    if (this.phase !== 'playing') return this.snapshot()

    while (this.nextRoundAtTick !== null && this.currentTick >= this.nextRoundAtTick) this.beginRound()
    this.spawnSafeEnemies()
    this.resolveBoardAttacks()
    const leaks = this.moveEnemiesAndCollectLeaks()
    this.applyLeaks(leaks)
    if (this.phase === 'playing') this.evaluateHardTimeout()
    return this.snapshot()
  }

  isQuiescent(): boolean {
    return this.phase === 'completed' || this.phase === 'voided'
  }

  sendPressure(playerId: string, requestId: string): PvpCommandResult {
    return this.idempotent(playerId, requestId, 'send_pressure', {}, () => {
      if (this.phase !== 'playing') return this.command(false, 'WRONG_PHASE', requestId)
      const senderSide = this.requirePlayerSide(playerId)
      if (!senderSide) return this.command(false, 'PLAYER_NOT_FOUND', requestId)
      const sender = this.sides[senderSide]!
      const defenderSide = oppositeSide(senderSide)
      const defender = this.sides[defenderSide]
      if (!defender) return this.command(false, 'OPPONENT_NOT_FOUND', requestId)
      if (sender.state.scripture < PRESSURE_COST) return this.rejectPressure(senderSide, requestId, 'INSUFFICIENT_SCRIPTURE')
      const cooldownTicks = Math.ceil(PRESSURE_COOLDOWN_MS / this.tickRateMs)
      if (sender.lastPressureAtTick !== null && this.currentTick - sender.lastPressureAtTick < cooldownTicks) {
        return this.rejectPressure(senderSide, requestId, 'PRESSURE_COOLDOWN')
      }
      if (defender.state.privateState.pendingPressure.length >= PRESSURE_QUEUE_LIMIT) {
        return this.rejectPressure(senderSide, requestId, 'PRESSURE_QUEUE_FULL')
      }

      sender.state.scripture -= PRESSURE_COST
      sender.state.stats.scriptureSpent += PRESSURE_COST
      sender.state.stats.pressureSent += 1
      sender.lastPressureAtTick = this.currentTick
      this.pressureSequence += 1
      const roundNumber = Math.max(1, this.roundNumber)
      const pressure: PvpPressureQueueEntry = {
        pressureId: `pressure-${this.pressureSequence}`,
        senderPlayerId: playerId,
        senderSide,
        defenderSide,
        requestId,
        queuedAtTick: this.currentTick,
        roundNumber,
        maxHp: Math.round(this.baseHpForRound(roundNumber) * 1.5),
      }
      defender.state.privateState.pendingPressure.push(pressure)
      defender.spawnQueue.push({
        spawnId: pressure.pressureId,
        kind: 'pressure',
        glyph: '妖',
        roundNumber,
        maxHp: pressure.maxHp,
        armor: this.baseDefenseForRound(roundNumber),
        magicResistance: this.baseDefenseForRound(roundNumber),
        moveSpeedMilliCellsPerSecond: this.speedForElapsed(),
        coreDamage: 1,
        queuedAtTick: this.currentTick,
        pressure,
      })
      this.emit('PRESSURE_QUEUED', {
        pressureId: pressure.pressureId,
        senderPlayerId: playerId,
        senderSide,
        defenderSide,
        requestId,
      })
      return this.command(true, 'PRESSURE_QUEUED', requestId, { pressureId: pressure.pressureId })
    })
  }

  applyAuthoritativeDamage(input: AuthoritativePvpDamageInput): PvpCommandResult {
    return this.idempotent(input.sourcePlayerId, input.eventId, 'authoritative_damage', {
      enemyId: input.enemyId,
      rawDamage: input.rawDamage,
      resolvedDamage: input.resolvedDamage,
    }, () => {
      if (this.phase !== 'playing') return this.command(false, 'WRONG_PHASE', input.eventId)
      const side = this.requirePlayerSide(input.sourcePlayerId)
      if (!side) return this.command(false, 'PLAYER_NOT_FOUND', input.eventId)
      if (!Number.isSafeInteger(input.rawDamage) || input.rawDamage <= 0
        || !Number.isSafeInteger(input.resolvedDamage) || input.resolvedDamage <= 0) {
        return this.command(false, 'INVALID_AUTHORITATIVE_DAMAGE', input.eventId)
      }
      const runtime = this.sides[side]!
      const enemyIndex = runtime.state.enemies.findIndex((enemy) => enemy.enemyId === input.enemyId)
      if (enemyIndex < 0) return this.command(false, 'ENEMY_NOT_FOUND', input.eventId)
      const enemy = runtime.state.enemies[enemyIndex]!
      if (enemy.spawnProtected) return this.command(false, 'ENEMY_SPAWN_PROTECTED', input.eventId)
      const hpBefore = enemy.hp
      const appliedDamage = Math.min(hpBefore, input.resolvedDamage)
      enemy.hp -= appliedDamage
      runtime.state.stats.damageDealt += appliedDamage
      this.emit('ENEMY_DAMAGED', {
        playerId: input.sourcePlayerId,
        side,
        enemyId: input.enemyId,
        rawDamage: input.rawDamage,
        damage: appliedDamage,
        hpBefore,
        hpAfter: enemy.hp,
      })
      if (enemy.hp <= 0) this.settleEnemyKill(runtime, enemyIndex)
      return this.command(true, 'ENEMY_DAMAGED', input.eventId, { appliedDamage, hpAfter: Math.max(0, enemy.hp) })
    })
  }

  surrender(playerId: string, requestId: string): PvpCommandResult {
    return this.idempotent(playerId, requestId, 'surrender', {}, () => {
      if (this.phase !== 'playing') return this.command(false, 'WRONG_PHASE', requestId)
      const side = this.requirePlayerSide(playerId)
      if (!side) return this.command(false, 'PLAYER_NOT_FOUND', requestId)
      this.emit('PLAYER_SURRENDERED', { playerId, side })
      this.finishWithWinner(oppositeSide(side), 'surrendered')
      return this.command(true, 'PLAYER_SURRENDERED', requestId)
    })
  }

  markDisconnected(playerId: string): PvpCommandResult {
    const side = this.requirePlayerSide(playerId)
    if (!side) return this.command(false, 'PLAYER_NOT_FOUND')
    const state = this.sides[side]!.state
    if (!state.connected) return this.command(true, 'PLAYER_ALREADY_DISCONNECTED')
    state.connected = false
    state.disconnectedAtTick = this.currentTick
    this.emit('PLAYER_CONNECTION_CHANGED', { playerId, side, connected: false })
    return this.command(true, 'PLAYER_DISCONNECTED')
  }

  markReconnected(playerId: string): PvpCommandResult {
    const side = this.requirePlayerSide(playerId)
    if (!side) return this.command(false, 'PLAYER_NOT_FOUND')
    const state = this.sides[side]!.state
    state.connected = true
    state.disconnectedAtTick = null
    this.emit('PLAYER_CONNECTION_CHANGED', { playerId, side, connected: true })
    return this.command(true, 'PLAYER_RECONNECTED')
  }

  voidMatch(reason: Extract<PvpResultReason, 'server_void' | 'ruleset_invalid' | 'load_failed' | 'load_timeout' | 'load_disconnect'>): PvpCommandResult {
    if (this.result || this.phase === 'completed' || this.phase === 'voided') return this.command(false, 'MATCH_ALREADY_DECIDED')
    const participants = { A: 'void', B: 'void' } as const
    for (const side of SIDES) if (this.sides[side]) this.sides[side]!.state.stats.result = 'void'
    this.result = {
      reason,
      winnerPlayerId: null,
      loserPlayerId: null,
      decidedAtTick: this.currentTick,
      finalStateHash: this.computeStateHash(),
      participants,
    }
    this.phase = 'voided'
    this.emit('PVP_MATCH_VOIDED', { reason })
    return this.command(true, 'MATCH_VOIDED')
  }

  completeSettlement(): PvpCommandResult {
    if (this.phase !== 'settling' || !this.result) return this.command(false, 'WRONG_PHASE')
    this.transitionTo('completed')
    return this.command(true, 'SETTLEMENT_COMPLETED')
  }

  snapshot(): PvpAuthorityState {
    return structuredClone({
      schemaVersion: 1 as const,
      matchId: this.matchId,
      mode: this.mode,
      phase: this.phase,
      tick: this.currentTick,
      tickRateMs: this.tickRateMs,
      seed: this.seed,
      rulesetVersion: this.rulesetVersion,
      mapId: DUAL_REALM_MAP.mapId,
      mapVersion: DUAL_REALM_MAP.mapVersion,
      routeHash: DUAL_REALM_MAP.routeHash,
      rulesSnapshot: this.rulesSnapshot,
      countdownRemainingTicks: this.countdownRemainingTicks,
      loading: {
        rulesetVersion: this.rulesetVersion,
        mapId: DUAL_REALM_MAP.mapId,
        mapVersion: DUAL_REALM_MAP.mapVersion,
        routeHash: DUAL_REALM_MAP.routeHash,
        assetsVersion: this.assetsVersion,
        deadlineAtTick: this.loadDeadlineAtTick,
        remainingTicks: this.loadDeadlineAtTick === null ? 0 : Math.max(0, this.loadDeadlineAtTick - this.currentTick),
      },
      round: {
        number: this.roundNumber,
        nextRoundAtTick: this.nextRoundAtTick,
        intervalTicks: this.roundIntervalTicks,
        baseCountPerSide: ROUND_BASE_COUNT,
      },
      tribulation: this.tribulationSnapshot(),
      sides: {
        A: this.sides.A?.state ?? null,
        B: this.sides.B?.state ?? null,
      },
      result: this.result,
      recentEvents: this.recentEvents,
    })
  }

  projectForViewer(viewerPlayerId: string | null): PvpRealtimeState {
    const authority = this.snapshot()
    const viewerSide = SIDES.find((side) => authority.sides[side]?.playerId === viewerPlayerId) ?? null
    const projectSide = (state: PvpSideState | null) => {
      if (!state) return null
      const isOwner = viewerPlayerId === state.playerId
      return {
        ...state,
        rations: isOwner ? state.rations : null,
        scripture: isOwner ? state.scripture : null,
        privateState: isOwner ? { ...state.privateState, pendingPressure: [] } : null,
      }
    }
    const { seed: _hiddenSeed, sides: _authoritySides, ...publicState } = authority
    const recentEvents = publicState.recentEvents.filter((event) => {
      if (event.type === 'PIECE_RECRUITED') return viewerPlayerId !== null && event.data.playerId === viewerPlayerId
      if (event.type !== 'PRESSURE_QUEUED' && event.type !== 'PRESSURE_REJECTED') return true
      return viewerSide !== null && event.data.senderSide === viewerSide
    })
    return {
      ...publicState,
      recentEvents,
      viewerPlayerId,
      sides: { A: projectSide(authority.sides.A), B: projectSide(authority.sides.B) },
    }
  }

  private beginPlaying(): void {
    this.playingStartedAtTick = this.currentTick
    this.transitionTo('playing')
    this.emit('MATCH_STARTED', { matchId: this.matchId, rulesetVersion: this.rulesetVersion })
    this.beginRound()
  }

  private enterLoading(): void {
    for (const side of SIDES) {
      const state = this.sides[side]?.state
      if (!state) continue
      state.loaded = false
      state.loadStatus = 'loading'
      state.loadFailureCode = null
      state.loadAcknowledgedAtTick = null
    }
    this.loadDeadlineAtTick = this.currentTick + this.loadTimeoutTicks
    this.transitionTo('loading')
  }

  private beginRound(): void {
    this.roundNumber += 1
    this.nextRoundAtTick = this.currentTick + this.roundIntervalTicks
    for (const side of SIDES) {
      const runtime = this.sides[side]!
      runtime.state.rations += ROUND_RATIONS
      runtime.state.stats.rationsEarned += ROUND_RATIONS
      this.emit('ROUND_RATIONS_GRANTED', { side, playerId: runtime.state.playerId, roundNumber: this.roundNumber, amount: ROUND_RATIONS })
      for (let index = 0; index < ROUND_BASE_COUNT; index += 1) {
        const kind: PvpEnemyKind = this.roundNumber % 10 === 0 && index === ROUND_BASE_COUNT - 1
          ? 'boss'
          : this.roundNumber % 10 !== 0 && this.roundNumber % 5 === 0 && index === ROUND_BASE_COUNT - 1
            ? 'elite'
            : 'base'
        const multiplier = kind === 'boss' ? 4 : kind === 'elite' ? 2 : 1
        this.spawnSequence += 1
        runtime.spawnQueue.push({
          spawnId: `round-${this.roundNumber}-${side}-${this.spawnSequence}`,
          kind,
          glyph: kind === 'boss' ? '魔' : kind === 'elite' ? '怪' : '妖',
          roundNumber: this.roundNumber,
          maxHp: this.baseHpForRound(this.roundNumber) * multiplier,
          armor: this.baseDefenseForRound(this.roundNumber),
          magicResistance: this.baseDefenseForRound(this.roundNumber),
          moveSpeedMilliCellsPerSecond: this.speedForElapsed(),
          coreDamage: kind === 'boss' ? 4 : kind === 'elite' ? 2 : 1,
          queuedAtTick: this.currentTick,
          pressure: null,
        })
      }
    }
    this.emit('ROUND_STARTED', { roundNumber: this.roundNumber, countPerSide: ROUND_BASE_COUNT })
  }

  private spawnSafeEnemies(): void {
    for (const side of SIDES) {
      const runtime = this.sides[side]!
      if (runtime.spawnQueue.length === 0 || !this.previousSpawnExited(runtime)) continue
      const pending = runtime.spawnQueue.shift()!
      this.enemySequence += 1
      const start = DUAL_REALM_MAP.sides[side].routeCells[0]!
      const enemy: PvpEnemyState = {
        enemyId: `pvp-enemy-${this.enemySequence}`,
        side,
        kind: pending.kind,
        glyph: pending.glyph,
        roundNumber: pending.roundNumber,
        xMilli: start.x * 1000,
        yMilli: start.y * 1000,
        routeCellIndex: 0,
        routeProgressMilli: 0,
        hp: pending.maxHp,
        maxHp: pending.maxHp,
        armor: pending.armor,
        magicResistance: pending.magicResistance,
        moveSpeedMilliCellsPerSecond: pending.moveSpeedMilliCellsPerSecond,
        coreDamage: pending.coreDamage,
        spawnProtected: true,
        pressureSourcePlayerId: pending.pressure?.senderPlayerId ?? null,
        pressureRequestId: pending.pressure?.requestId ?? null,
      }
      runtime.state.enemies.push(enemy)
      runtime.lastSpawnedEnemyId = enemy.enemyId
      if (pending.pressure) {
        const pressureIndex = runtime.state.privateState.pendingPressure
          .findIndex((entry) => entry.pressureId === pending.pressure!.pressureId)
        if (pressureIndex >= 0) runtime.state.privateState.pendingPressure.splice(pressureIndex, 1)
      }
      this.emit('ENEMY_SPAWNED', {
        enemyId: enemy.enemyId,
        side,
        kind: enemy.kind,
        roundNumber: enemy.roundNumber,
        pressureSourcePlayerId: enemy.pressureSourcePlayerId,
      })
    }
  }

  private previousSpawnExited(runtime: RuntimeSide): boolean {
    if (!runtime.lastSpawnedEnemyId) return true
    const enemy = runtime.state.enemies.find((candidate) => candidate.enemyId === runtime.lastSpawnedEnemyId)
    return !enemy || !enemy.spawnProtected
  }

  private resolveBoardAttacks(): void {
    for (const side of SIDES) {
      const runtime = this.sides[side]!
      for (const piece of runtime.state.boardPieces) {
        if (piece.kind !== 'soldier' || !piece.soldierType) continue
        const definition = pvpSoldier(piece.soldierType)
        const intervalTicks = Math.max(1, Math.ceil(definition.attackIntervalMs / this.tickRateMs))
        const lastAttack = runtime.lastAttackAtTick.get(piece.entityId)
        if (lastAttack !== undefined && this.currentTick - lastAttack < intervalTicks) continue
        const rangeSquared = definition.rangeMilli * definition.rangeMilli
        const candidates = runtime.state.enemies
          .filter((enemy) => !enemy.spawnProtected && this.distanceSquared(piece.x * 1000, piece.y * 1000, enemy.xMilli, enemy.yMilli) <= rangeSquared)
          .sort((left, right) => (right.routeCellIndex * 1000 + right.routeProgressMilli) - (left.routeCellIndex * 1000 + left.routeProgressMilli) || left.enemyId.localeCompare(right.enemyId))
        const primary = candidates[0]
        if (!primary) continue
        const targets = definition.attackStyle === 'pierce'
          ? candidates.slice(0, 2)
          : definition.attackStyle === 'splash'
            ? runtime.state.enemies.filter((enemy) => !enemy.spawnProtected && this.distanceSquared(primary.xMilli, primary.yMilli, enemy.xMilli, enemy.yMilli) <= 1_500 * 1_500)
            : [primary]
        runtime.lastAttackAtTick.set(piece.entityId, this.currentTick)
        let hitCount = 0
        const level = piece.level ?? 1
        const levelBps = level === 1 ? 10_000 : level === 2 ? 17_000 : 26_000
        const rawDamage = Math.max(1, Math.round(definition.damage * levelBps / 10_000))
        for (const [targetIndex, target] of targets.entries()) {
          const resolvedDamage = Math.max(1, rawDamage - Math.max(0, target.armor - definition.armorPierce))
          const result = this.applyAuthoritativeDamage({
            eventId: `auto:${this.currentTick}:${piece.entityId}:${targetIndex}:${target.enemyId}`,
            sourcePlayerId: runtime.state.playerId,
            enemyId: target.enemyId,
            rawDamage,
            resolvedDamage,
          })
          if (result.ok) hitCount += 1
        }
        this.emit('PIECE_ATTACKED', {
          playerId: runtime.state.playerId, side, entityId: piece.entityId, soldierType: piece.soldierType,
          attackStyle: definition.attackStyle, primaryEnemyId: primary.enemyId, hitCount,
        })
      }
    }
  }

  private distanceSquared(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx
    const dy = ay - by
    return dx * dx + dy * dy
  }

  private isStandardDeploymentSlot(side: PvpSide, x: number, y: number): boolean {
    return this.rulesSnapshot.deploymentSlots[side].some((cell) => cell.x === x && cell.y === y)
  }

  private findRecruit(runtime: RuntimeSide, unitId: string) {
    for (const collection of [runtime.state.privateState.tray, runtime.state.privateState.reserve]) {
      const index = collection.findIndex((unit) => unit?.unitId === unitId)
      if (index >= 0) return { collection, index, unit: collection[index]! }
    }
    return null
  }

  private moveEnemiesAndCollectLeaks(): Array<{ side: PvpSide, enemy: PvpEnemyState }> {
    const leaks: Array<{ side: PvpSide, enemy: PvpEnemyState }> = []
    for (const side of SIDES) {
      const runtime = this.sides[side]!
      const survivors: PvpEnemyState[] = []
      for (const enemy of runtime.state.enemies) {
        if (this.moveEnemy(enemy)) leaks.push({ side, enemy })
        else survivors.push(enemy)
      }
      runtime.state.enemies = survivors
    }
    return leaks
  }

  private moveEnemy(enemy: PvpEnemyState): boolean {
    const route = DUAL_REALM_MAP.sides[enemy.side].routeCells
    let remaining = Math.max(0, Math.floor(enemy.moveSpeedMilliCellsPerSecond * this.tickRateMs / 1000))
    while (remaining > 0) {
      const next = route[enemy.routeCellIndex + 1]
      if (!next) return true
      const distanceToNext = 1000 - enemy.routeProgressMilli
      const travel = Math.min(remaining, distanceToNext)
      const current = route[enemy.routeCellIndex]!
      enemy.routeProgressMilli += travel
      remaining -= travel
      const ratio = enemy.routeProgressMilli / 1000
      enemy.xMilli = Math.round((current.x + (next.x - current.x) * ratio) * 1000)
      enemy.yMilli = Math.round((current.y + (next.y - current.y) * ratio) * 1000)
      if (enemy.routeProgressMilli >= 1000) {
        enemy.routeCellIndex += 1
        enemy.routeProgressMilli = 0
        enemy.xMilli = next.x * 1000
        enemy.yMilli = next.y * 1000
      }
    }
    if (enemy.spawnProtected && hasEnemyBodyFullyExitedPvpSpawnGate(enemy.side, enemy.xMilli, enemy.yMilli)) {
      enemy.spawnProtected = false
      this.emit('ENEMY_ENTERED_BATTLEFIELD', { enemyId: enemy.enemyId, side: enemy.side })
    }
    return false
  }

  private applyLeaks(leaks: Array<{ side: PvpSide, enemy: PvpEnemyState }>): void {
    if (leaks.length === 0 || this.phase !== 'playing') return
    const damageBySide: Record<PvpSide, number> = { A: 0, B: 0 }
    const remainingCoreHp: Record<PvpSide, number> = {
      A: this.sides.A!.state.coreHp,
      B: this.sides.B!.state.coreHp,
    }
    const tribulation = this.tribulationSnapshot()
    for (const { side, enemy } of leaks) {
      const defender = this.sides[side]!
      defender.state.stats.leaks += 1
      if (enemy.kind === 'pressure' && enemy.pressureSourcePlayerId) {
        const senderSide = this.findSideByPlayerId(enemy.pressureSourcePlayerId)
        if (senderSide) this.sides[senderSide]!.state.stats.pressureLeaked += 1
        this.emit('PRESSURE_RESOLVED', { enemyId: enemy.enemyId, result: 'leaked', defenderSide: side })
      }
      const requestedDamage = tribulation.oneLeakDefeat
        ? CORE_HP
        : enemy.coreDamage + tribulation.coreDamageBonus
      const appliedDamage = Math.min(remainingCoreHp[side], requestedDamage)
      remainingCoreHp[side] -= appliedDamage
      damageBySide[side] += appliedDamage
      if (enemy.kind === 'pressure' && enemy.pressureSourcePlayerId) {
        const senderSide = this.findSideByPlayerId(enemy.pressureSourcePlayerId)
        if (senderSide) this.sides[senderSide]!.state.stats.coreDamageDealt += appliedDamage
      }
    }
    for (const side of SIDES) {
      if (damageBySide[side] <= 0) continue
      const state = this.sides[side]!.state
      const before = state.coreHp
      state.coreHp = Math.max(0, state.coreHp - damageBySide[side])
      state.stats.coreHpRemaining = state.coreHp
      this.emit('CORE_DAMAGED', { side, damage: damageBySide[side], coreHpBefore: before, coreHpAfter: state.coreHp })
    }
    const aDefeated = this.sides.A!.state.coreHp <= 0
    const bDefeated = this.sides.B!.state.coreHp <= 0
    if (aDefeated && bDefeated) this.finishDraw('simultaneous_draw')
    else if (aDefeated) this.finishWithWinner('B', 'core_destroyed')
    else if (bDefeated) this.finishWithWinner('A', 'core_destroyed')
  }

  private settleEnemyKill(runtime: RuntimeSide, enemyIndex: number): void {
    const [enemy] = runtime.state.enemies.splice(enemyIndex, 1)
    if (!enemy) return
    if (enemy.kind === 'pressure') {
      runtime.state.rations += 2
      runtime.state.stats.rationsEarned += 2
      runtime.state.stats.pressureKills += 1
      this.emit('PRESSURE_RESOLVED', { enemyId: enemy.enemyId, result: 'killed', defenderSide: runtime.state.side })
    }
    else {
      runtime.state.rations += 1
      runtime.state.scripture += 1
      runtime.state.stats.rationsEarned += 1
      runtime.state.stats.scriptureEarned += 1
      runtime.state.stats.baseKills += 1
    }
    this.emit('ENEMY_KILLED', { enemyId: enemy.enemyId, side: runtime.state.side, kind: enemy.kind })
  }

  private evaluateDisconnectForfeits(): void {
    const disconnected = SIDES.filter((side) => {
      const state = this.sides[side]!.state
      return !state.connected && state.disconnectedAtTick !== null
    })
    const timedOut = SIDES.filter((side) => {
      const state = this.sides[side]!.state
      return !state.connected && state.disconnectedAtTick !== null
        && this.currentTick - state.disconnectedAtTick >= this.disconnectForfeitTicks
    })
    // 两端在同一断线窗口内离场时，TCP close 到达的先后不应决定胜负。
    // 等两侧各自完成超时；若一方提前重连，则另一方按正常断线判负。
    if (disconnected.length === 2) {
      if (timedOut.length === 2) this.finishDraw('simultaneous_draw')
      return
    }
    if (timedOut.length === 2) this.finishDraw('simultaneous_draw')
    else if (timedOut.length === 1) this.finishWithWinner(oppositeSide(timedOut[0]!), 'disconnect_forfeit')
  }

  private evaluateHardTimeout(): void {
    const elapsed = this.elapsedPlayingTicks()
    if (elapsed < Math.ceil(HARD_TIMEOUT_MS / this.tickRateMs)) return
    const a = this.sides.A!.state
    const b = this.sides.B!.state
    if (a.coreHp !== b.coreHp) this.finishWithWinner(a.coreHp > b.coreHp ? 'A' : 'B', 'hard_timeout')
    else {
      const aRemainingEnemyHp = a.enemies.reduce((total, enemy) => total + enemy.hp, 0)
      const bRemainingEnemyHp = b.enemies.reduce((total, enemy) => total + enemy.hp, 0)
      if (aRemainingEnemyHp !== bRemainingEnemyHp) {
        this.finishWithWinner(aRemainingEnemyHp < bRemainingEnemyHp ? 'A' : 'B', 'hard_timeout')
      }
      else if (a.stats.coreDamageDealt !== b.stats.coreDamageDealt) {
        this.finishWithWinner(a.stats.coreDamageDealt > b.stats.coreDamageDealt ? 'A' : 'B', 'hard_timeout')
      }
      else this.finishDraw('hard_timeout')
    }
  }

  private updateTribulation(): void {
    // 数值由 tribulationSnapshot 按权威对局时长计算；此方法保留为明确 Tick 阶段。
  }

  private tribulationSnapshot() {
    const elapsedMs = this.elapsedPlayingTicks() * this.tickRateMs
    const tier = elapsedMs < TRIBULATION_START_MS
      ? 0
      : Math.floor((elapsedMs - TRIBULATION_START_MS) / 20_000) + 1
    return {
      active: tier > 0,
      tier,
      hpBonusBps: tier * 2000,
      moveSpeedBonusBps: tier * 500,
      coreDamageBonus: elapsedMs >= CORE_DAMAGE_BONUS_START_MS ? 1 : 0,
      oneLeakDefeat: elapsedMs >= ONE_LEAK_DEFEAT_START_MS,
      hardTimeoutAtTick: (this.playingStartedAtTick ?? 0) + Math.ceil(HARD_TIMEOUT_MS / this.tickRateMs),
    }
  }

  private baseHpForRound(roundNumber: number): number {
    const base = Math.round(28 * 1.16 ** Math.max(0, roundNumber - 1))
    return Math.round(base * (10_000 + this.tribulationSnapshot().hpBonusBps) / 10_000)
  }

  private baseDefenseForRound(roundNumber: number): number {
    return Math.max(0, 2 * (roundNumber - 1))
  }

  private speedForElapsed(): number {
    return Math.round(1000 * (10_000 + this.tribulationSnapshot().moveSpeedBonusBps) / 10_000)
  }

  private elapsedPlayingTicks(): number {
    return this.playingStartedAtTick === null ? 0 : Math.max(0, this.currentTick - this.playingStartedAtTick)
  }

  private rejectPressure(senderSide: PvpSide, requestId: string, code: string): PvpCommandResult {
    this.emit('PRESSURE_REJECTED', { senderSide, requestId, code })
    return this.command(false, code, requestId)
  }

  private finishWithWinner(winnerSide: PvpSide, reason: PvpResultReason): void {
    const loserSide = oppositeSide(winnerSide)
    this.finish(reason, winnerSide, {
      [winnerSide]: 'win',
      [loserSide]: 'loss',
    } as Record<PvpSide, PvpParticipantResult>)
  }

  private finishDraw(reason: Extract<PvpResultReason, 'simultaneous_draw' | 'hard_timeout'>): void {
    this.finish(reason, null, { A: 'draw', B: 'draw' })
  }

  private finish(
    reason: PvpResultReason,
    winnerSide: PvpSide | null,
    participants: Record<PvpSide, PvpParticipantResult>,
  ): void {
    if (this.phase !== 'playing' || this.result) return
    for (const side of SIDES) this.sides[side]!.state.stats.result = participants[side]
    const loserSide = winnerSide ? oppositeSide(winnerSide) : null
    this.result = {
      reason,
      winnerPlayerId: winnerSide ? this.sides[winnerSide]!.state.playerId : null,
      loserPlayerId: loserSide ? this.sides[loserSide]!.state.playerId : null,
      decidedAtTick: this.currentTick,
      finalStateHash: this.computeStateHash(),
      participants,
    }
    this.transitionTo('settling')
    this.emit('PVP_MATCH_FINISHED', {
      reason,
      winnerPlayerId: this.result.winnerPlayerId,
      loserPlayerId: this.result.loserPlayerId,
      finalStateHash: this.result.finalStateHash,
    })
  }

  private computeStateHash(): string {
    const state = {
      matchId: this.matchId,
      tick: this.currentTick,
      roundNumber: this.roundNumber,
      rngState: this.prng.snapshot(),
      sides: SIDES.map((side) => {
        const runtime = this.sides[side]
        return runtime ? {
          side,
          playerId: runtime.state.playerId,
          coreHp: runtime.state.coreHp,
          rations: runtime.state.rations,
          scripture: runtime.state.scripture,
          populationUsed: runtime.state.populationUsed,
          boardPieces: runtime.state.boardPieces,
          privateState: runtime.state.privateState,
          enemies: runtime.state.enemies,
          spawnQueue: runtime.spawnQueue,
          stats: runtime.state.stats,
        } : null
      }),
    }
    return createHash('sha256').update(stableJson(state)).digest('hex')
  }

  private transitionTo(phase: PvpAuthorityState['phase']): void {
    if (this.phase === phase) return
    const previous = this.phase
    this.phase = phase
    this.emit('PHASE_CHANGED', { previousPhase: previous, phase })
  }

  private emit(type: PvpRuntimeEvent['type'], data: PvpRuntimeEvent['data']): void {
    this.eventSequence += 1
    this.recentEvents.push({ eventId: `pvp-event-${this.eventSequence}`, tick: this.currentTick, type, data })
    if (this.recentEvents.length > this.eventHistoryLimit) this.recentEvents.splice(0, this.recentEvents.length - this.eventHistoryLimit)
  }

  private requirePlayerSide(playerId: string): PvpSide | null {
    return this.findSideByPlayerId(playerId)
  }

  private findSideByPlayerId(playerId: string): PvpSide | null {
    return SIDES.find((side) => this.sides[side]?.state.playerId === playerId) ?? null
  }

  private command(
    ok: boolean,
    code: string,
    requestId?: string,
    details?: PvpCommandResult['details'],
  ): PvpCommandResult {
    return { ok, code, tick: this.currentTick, ...(requestId ? { requestId } : {}), ...(details ? { details } : {}) }
  }

  private idempotent(
    playerId: string,
    requestId: string,
    operation: string,
    payload: Record<string, unknown>,
    apply: () => PvpCommandResult,
  ): PvpCommandResult {
    if (!requestId.trim()) return this.command(false, 'REQUEST_ID_REQUIRED')
    const key = `${playerId}:${requestId}`
    const fingerprint = stableJson({ operation, payload })
    const previous = this.commandReceipts.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) return this.command(false, 'REQUEST_ID_CONFLICT', requestId)
      return { ...structuredClone(previous.result), duplicate: true }
    }
    const result = apply()
    this.commandReceipts.set(key, { fingerprint, result: structuredClone(result) })
    return result
  }
}
