import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { GameLoop } from '../core/game-loop'
import { ProjectedTickStream } from '../core/projected-tick-stream'
import { Room, RoomManager } from '../core/Room'
import type { PerformanceTelemetry } from '../core/performance-telemetry'
import type { PlayerIdentity } from '../domain/actions'
import type { ServerConfig } from '../config/server-config'
import { submitAction, submitDurablePveAction } from './action-submission'
import { ActionRateLimiter } from './action-rate-limiter'
import { authenticateGatewayTokenAsync, extractSocketToken, type GatewayPrincipal } from './gateway-auth'
import type { ProgressStore } from '../data/progress-store'
import type { PlayerType } from '../domain/progress'
import { checkPveStageUnlock } from '../core/unlock-logic'
import { LEVEL_CONFIGS } from '../config/level-config'
import {
  getPveStageDefinition,
  isPveDifficulty,
  isPveStageSelection,
  pveStageKey,
  type PveStageSelection,
} from '../../../shared/contracts/pve-stage-config'
import type { PlayerAccountService } from '../account-v1/service'
import { PveRewardService, PveSettlementCoordinator } from '../pve-reward-v1'
import {
  buildPveSettlementDetail,
  createSettlementTelemetry,
  ingestSettlementEvents,
  resolveSettlementStats,
  type PveSettlementTelemetry,
} from '../pve-reward-v1/settlement-detail'
import type { GameState } from '../domain/game-state'
import { getPassiveItemDefinition } from '../item-v1'
import { PVE_WEAPON_REWARD_TABLE_REVISION } from '../weapon-v1'
import { PlayerReconnectRegistry, type PendingPlayerDisconnect } from './reconnect-registry'
import type { PveCheckpointCoordinator } from '../pve-checkpoint-v1'
import {
  COMBAT_PRESENTATION_VERSION,
  type CombatEventAck,
  type CombatEventReplayRequest,
  type GameState as FrontendGameState,
  type GameStatePatch,
} from '../../../shared/contracts/game'
import { E2E_RENDERER_STRESS_MATCH, E2E_RENDERER_STRESS_ROOM, stressCombatBatch, stressFullState, stressPatch } from './e2e-renderer-stress'

function readHandshakeValue(socket: Socket, key: string) {
  const queryValue = socket.handshake.query[key]
  if (typeof queryValue === 'string' && queryValue.length > 0) {
    return queryValue
  }

  return undefined
}

interface JoinRoomPayload {
  roomId: string
  password?: string
  playerId?: string
  playerName?: string
  playerKind?: 'human' | 'agent'
  capabilities?: {
    combatEventBatch?: number
  }
}

interface BuildTowerPayload {
  x: number
  y: number
  towerType: string
}

interface RoomRuntime {
  room: Room
  loop: GameLoop
  projectedTickStream: ProjectedTickStream
  unsubscribeProjection: () => void
  unsubscribeSettlement: () => void
  reconnectRegistry: PlayerReconnectRegistry
  ownsProjectedTickStream: boolean
  rewardQueue: Promise<void>
  settledMatchIds: Set<string>
  scheduledRewardKeys: Set<string>
  scheduledDepartures: Set<string>
  settlementTelemetry: PveSettlementTelemetry | null
}

interface JoinedRoomContext {
  room: Room
  runtime: RoomRuntime
  identity: PlayerIdentity
}

interface SerializedRoomSummary {
  id: string
  name: string
  hasPassword: boolean
  players: number
  maxPlayers: number
  status: 'OPEN' | 'IN_MATCH' | 'DRAFTING'
  pingMs: number | null
  slots: Array<ReturnType<Room['getSummary']>['slots'][number] & {
    reconnectDeadlineAt?: number
    reconnectRemainingMs?: number
  }>
}

const DEFAULT_ROOM_ID = 'public-1'
const COUNTDOWN_DURATION_MS = 3000
const COMBAT_PROTOCOL_ROOM_PREFIX = '__combat-event-v1__:'
const ROOM_PASSWORD_ATTEMPT_WINDOW_MS = 60_000
const ROOM_PASSWORD_ATTEMPT_MAX = 5

function combatProtocolRoom(roomId: string) {
  return `${COMBAT_PROTOCOL_ROOM_PREFIX}${roomId}`
}

function supportsCombatEventBatch(payload: JoinRoomPayload) {
  return payload.capabilities?.combatEventBatch === COMBAT_PRESENTATION_VERSION
}

function detachCombatEvents<T extends FrontendGameState | GameStatePatch>(state: T): T {
  if (!state.pve) return state
  return { ...state, pve: { ...state.pve, recentEvents: [] } }
}

function isJoinRoomPayload(payload: unknown): payload is JoinRoomPayload {
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as JoinRoomPayload).roomId === 'string'
    && (payload as JoinRoomPayload).roomId.trim().length > 0
}

function parseStageSelection(payload: unknown): PveStageSelection | null {
  if (typeof payload !== 'object' || payload === null) return null
  const candidate = payload as { levelId?: unknown; difficulty?: unknown }
  const difficulty = candidate.difficulty === undefined ? 'easy' : candidate.difficulty
  const selection = { levelId: candidate.levelId, difficulty }
  return isPveStageSelection(selection) ? selection : null
}

function isBuildTowerPayload(payload: unknown): payload is BuildTowerPayload {
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as BuildTowerPayload).x === 'number'
    && typeof (payload as BuildTowerPayload).y === 'number'
    && typeof (payload as BuildTowerPayload).towerType === 'string'
}

export class SocketGateway {
  readonly io: Server

  private readonly config: ServerConfig

  private readonly roomManager: RoomManager

  private readonly roomRuntimes = new Map<string, RoomRuntime>()

  private readonly pveRewardService: PveRewardService

  private readonly settlementCoordinator: PveSettlementCoordinator | null

  private roomLoopsStarted: boolean

  private readonly e2eRendererStressTimers = new Map<string, NodeJS.Timeout>()

  /** Per-room/player guard for password brute-force attempts. Values are never persisted or exposed. */
  private readonly roomPasswordAttempts = new Map<string, { windowStartedAt: number; count: number; blockedUntil: number }>()

  setE2eHostLoopInterval(roomId: string, playerId: string, requestedIntervalMs: number) {
    if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production') {
      return { ok: false as const, code: 'PVE_E2E_DISABLED' }
    }
    const room = this.roomManager.getRoom(roomId)
    if (!room) return { ok: false as const, code: 'ROOM_NOT_FOUND' }
    if (!room.getPlayerSlot(playerId)) return { ok: false as const, code: 'ROOM_ACCESS_DENIED' }
    if (!Number.isFinite(requestedIntervalMs)) return { ok: false as const, code: 'INVALID_INTERVAL' }
    const intervalMs = Math.max(1, Math.min(this.config.tickRateMs, Math.round(requestedIntervalMs)))
    const runtime = this.ensureRoomRuntime(roomId)
    runtime.loop.setIntervalMs(intervalMs)
    return { ok: true as const, intervalMs, logicalTickRateMs: this.config.tickRateMs }
  }

  getE2eAuthoritativeState(roomId: string, playerId: string) {
    if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production') return null
    const room = this.roomManager.getRoom(roomId)
    if (!room || !room.getPlayerSlot(playerId)) return null
    return room.engine.getStateSnapshot()
  }

  async submitE2eAction(roomId: string, principal: GatewayPrincipal, payload: unknown) {
    if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production') {
      return { ok: false as const, status: 404, code: 'PVE_E2E_DISABLED' }
    }
    const room = this.roomManager.getRoom(roomId)
    if (!room) return { ok: false as const, status: 404, code: 'ROOM_NOT_FOUND' }
    if (!room.getPlayerSlot(principal.playerId)) return { ok: false as const, status: 403, code: 'ROOM_ACCESS_DENIED' }
    try {
      const state = room.engine.getStateSnapshot()
      const submission = this.checkpointCoordinator && state.status === 'running' && state.pve
        ? await submitDurablePveAction({
            engine: room.engine, room, checkpointCoordinator: this.checkpointCoordinator,
            limiter: this.actionLimiter, player: principal, payload,
          })
        : submitAction({ engine: room.engine, limiter: this.actionLimiter, player: principal, payload })
      return submission.ok ? { ...submission, status: 202 } : submission
    }
    catch {
      return { ok: false as const, status: 503, code: 'PVE_PERSISTENCE_UNAVAILABLE' }
    }
  }

  constructor(
    httpServer: HttpServer,
    roomManager: RoomManager,
    config: ServerConfig,
    private readonly telemetry: PerformanceTelemetry,
    private readonly actionLimiter: ActionRateLimiter,
    private readonly progressStore: ProgressStore,
    private readonly defaultProjectedTickStream?: ProjectedTickStream,
    private readonly accountService?: PlayerAccountService,
    pveRewardService = new PveRewardService(),
    settlementCoordinator?: PveSettlementCoordinator,
    private readonly checkpointCoordinator?: PveCheckpointCoordinator,
    deferRoomLoops = false,
  ) {
    this.config = config
    this.roomManager = roomManager
    this.pveRewardService = pveRewardService
    this.settlementCoordinator = settlementCoordinator
      ?? (accountService ? new PveSettlementCoordinator(pveRewardService.store, accountService) : null)
    this.roomLoopsStarted = !deferRoomLoops
    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin === '*' ? true : config.corsOrigin,
        credentials: true,
      },
    })

    this.io.use((socket, next) => {
      void authenticateGatewayTokenAsync(this.config, extractSocketToken(socket))
        .then((principal) => {
          if (!principal) {
            next(new Error('Missing or invalid gateway token'))
            return
          }
          socket.data.principal = principal
          next()
        })
        .catch(() => next(new Error('Authentication service unavailable')))
    })

    this.io.on('connection', (socket) => {
      this.handleConnection(socket)
    })

    for (const room of this.roomManager.listRooms()) {
      this.ensureRoomRuntime(room.id)
    }
  }

  private handleConnection(socket: Socket) {
    this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size)

    socket.on('JOIN_ROOM', (payload: unknown) => {
      const requestedRoomId = typeof payload === 'object' && payload !== null && 'roomId' in payload
        ? (payload as { roomId?: unknown }).roomId : null
      if (requestedRoomId === E2E_RENDERER_STRESS_ROOM) {
        this.startE2eRendererStress(socket)
        return
      }
      this.handleJoinRoom(socket, payload)
    })

    socket.on('SEND_ACTION', (payload: unknown) => {
      void this.handleActionSubmission(socket, payload)
    })

    socket.on('BUILD_TOWER', (payload: unknown) => {
      this.handleBuildTower(socket, payload)
    })

    socket.on('START_MATCH', () => {
      this.handleStartMatch(socket)
    })

    socket.on('SELECT_LEVEL', (payload: unknown) => {
      void this.handleSelectLevel(socket, payload)
    })

    socket.on('REQUEST_FULL_STATE', () => {
      this.handleFullStateRequest(socket)
    })

    socket.on('COMBAT_EVENT_ACK', (payload: unknown) => {
      this.handleCombatEventAck(socket, payload)
    })

    socket.on('REQUEST_COMBAT_EVENTS', (payload: unknown) => {
      this.handleCombatEventReplayRequest(socket, payload)
    })

    socket.on('disconnect', () => {
      const stressTimer = this.e2eRendererStressTimers.get(socket.id)
      if (stressTimer) clearInterval(stressTimer)
      this.e2eRendererStressTimers.delete(socket.id)
      this.leaveJoinedRoom(socket)
      this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size)
    })
  }

  shutdown(onClosed: () => void) {
    for (const timer of this.e2eRendererStressTimers.values()) clearInterval(timer)
    this.e2eRendererStressTimers.clear()
    for (const runtime of this.roomRuntimes.values()) {
      runtime.reconnectRegistry.shutdown()
      runtime.unsubscribeProjection()
      runtime.unsubscribeSettlement()
      if (runtime.ownsProjectedTickStream) {
        runtime.projectedTickStream.dispose()
      }
      runtime.loop.stop()
    }

    this.roomRuntimes.clear()
    this.io.close(onClosed)
  }

  private startE2eRendererStress(socket: Socket) {
    if (!this.config.pveE2eEnabled || process.env.NODE_ENV === 'production') {
      this.emitEngineError(socket, 'NOT_FOUND', 'Renderer stress fixture is unavailable')
      return
    }
    const existing = this.e2eRendererStressTimers.get(socket.id)
    if (existing) return
    socket.data.e2eRendererStress = true
    socket.emit('ROOM_JOINED', { roomId: E2E_RENDERER_STRESS_ROOM, slot: 'P1', phase: 'playing', hostPlayerId: 'human-dev', reconnected: false })
    socket.emit('ROOM_SNAPSHOT', { id: E2E_RENDERER_STRESS_ROOM, slots: [{ slotId: 'P1', playerId: 'human-dev', playerName: 'Renderer QA', connected: true, connectionState: 'connected', isHost: true }] })
    socket.emit('ROOM_PHASE_CHANGED', { phase: 'playing' })
    socket.emit('LEVEL_SELECTED', { levelId: 1, difficulty: 'easy', label: '渲染协议压力', description: '仅渲染与增量协议验收，不生成伤害、奖励或结算。', waveCount: 20, targetClearRate: 0, minPlayers: 1 })
    let revision = 1; let tick = 0; let sequence = 0
    socket.emit('TICK_UPDATE', { mode: 'full', gameState: stressFullState(tick), sentAt: Date.now(), revision, presentationVersion: 1, eventSeq: 0, eventsDetached: true })
    const timer = setInterval(() => {
      const baseRevision = revision; revision += 1; tick += 10; sequence += 1
      socket.emit('TICK_UPDATE', { mode: 'patch', patch: stressPatch(tick), sentAt: Date.now(), revision, baseRevision, eventsDetached: true })
      socket.emit('COMBAT_EVENT_BATCH', stressCombatBatch(sequence, tick))
    }, 200)
    this.e2eRendererStressTimers.set(socket.id, timer)
  }

  startRoomLoops(): void {
    this.roomLoopsStarted = true
    for (const runtime of this.roomRuntimes.values()) runtime.loop.start()
  }

  prepareRoomRuntimes(): void {
    for (const room of this.roomManager.listRooms()) this.ensureRoomRuntime(room.id)
  }

  stopRoomLoops(): void {
    this.roomLoopsStarted = false
    for (const runtime of this.roomRuntimes.values()) runtime.loop.stop()
  }

  private handleJoinRoom(socket: Socket, payload: unknown) {
    if (!isJoinRoomPayload(payload)) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 roomId')
      return
    }

    const identity = this.resolvePlayerIdentity(socket, payload)
    const nextRoomId = payload.roomId.trim()
    const currentRoomId = this.getJoinedRoomId(socket)
    const currentPlayerId = this.getJoinedIdentity(socket)?.playerId

    if (currentRoomId === nextRoomId && currentPlayerId === identity.playerId) {
      const runtime = this.ensureRoomRuntime(nextRoomId)
      const slot = runtime.room.getPlayerSlot(identity.playerId)
      if (!slot) {
        this.emitEngineError(socket, 'ROOM_JOIN_STATE_INVALID', '玩家房间状态异常，请重新连接')
        return
      }

      this.configureCombatProtocol(socket, nextRoomId, supportsCombatEventBatch(payload))
      this.emitJoinSnapshot(socket, runtime, slot)
      return
    }

    if (currentRoomId && (currentRoomId !== nextRoomId || currentPlayerId !== identity.playerId)) {
      this.leaveJoinedRoom(socket)
    }

    const runtime = this.ensureRoomRuntime(nextRoomId)
    const existingSlot = runtime.room.getPlayerSlot(identity.playerId)
    if (!existingSlot && runtime.room.requiresPassword()) {
      const password = typeof payload.password === 'string' ? payload.password : ''
      const principal = socket.data.principal as GatewayPrincipal | undefined
      const passwordResult = this.checkRoomPassword(
        nextRoomId,
        principal?.playerId ?? identity.playerId,
        socket.handshake.address,
        password,
        runtime.room,
      )
      if (!passwordResult.ok) {
        this.emitEngineError(socket, passwordResult.code, passwordResult.message, passwordResult.retryAfterMs)
        return
      }
    }
    if (!existingSlot && !runtime.room.isAcceptingNewPlayers()) {
      this.emitEngineError(socket, 'MATCH_IN_PROGRESS', '对局构筑已锁定，只允许原玩家重连')
      return
    }
    const assignedSlot = existingSlot ?? runtime.room.joinPlayer(identity.playerId)

    if (!assignedSlot) {
      this.emitEngineError(socket, 'ROOM_FULL', 'Room is full')
      return
    }

    const attachment = runtime.reconnectRegistry.attach(identity.playerId, socket.id)
    if (!attachment.ok || !attachment.lease) {
      this.emitEngineError(socket, 'RECONNECT_WINDOW_EXPIRED', '重连期限已过，离场结算正在处理中')
      return
    }
    if (attachment.supersededSocketId) {
      this.invalidateSupersededSocket(runtime.room.id, identity.playerId, attachment.supersededSocketId)
    }
    if (existingSlot) runtime.room.engine.restorePlayerConnection(identity)
    else runtime.room.engine.registerPlayer(identity)
    socket.join(nextRoomId)
    this.configureCombatProtocol(socket, nextRoomId, supportsCombatEventBatch(payload))
    socket.data.identity = identity
    socket.data.roomId = nextRoomId
    socket.data.connectionGeneration = attachment.lease.generation

    this.emitJoinSnapshot(socket, runtime, assignedSlot, attachment.reconnected)
    this.emitPlayerConnectionState(runtime, identity.playerId, 'connected', null)
    this.emitRoomSnapshot(runtime)
  }

  private checkRoomPassword(roomId: string, playerId: string, address: string, password: string, room: Room):
    { ok: true } | { ok: false; code: string; message: string; retryAfterMs?: number } {
    const key = `${roomId}:${playerId}:${address}`
    const now = Date.now()
    const current = this.roomPasswordAttempts.get(key)
    if (current && current.blockedUntil > now) {
      this.telemetry.incrementCounter('room.password.rate_limited')
      return {
        ok: false,
        code: 'PASSWORD_ATTEMPTS_EXCEEDED',
        message: '密码尝试次数过多，请稍后再试',
        retryAfterMs: current.blockedUntil - now,
      }
    }

    const state = !current || now - current.windowStartedAt >= ROOM_PASSWORD_ATTEMPT_WINDOW_MS
      ? { windowStartedAt: now, count: 0, blockedUntil: 0 }
      : current
    if (!password || !room.verifyJoinPassword(password)) {
      state.count += 1
      if (state.count >= ROOM_PASSWORD_ATTEMPT_MAX) state.blockedUntil = now + ROOM_PASSWORD_ATTEMPT_WINDOW_MS
      this.roomPasswordAttempts.set(key, state)
      this.telemetry.incrementCounter('room.password.rejected')
      if (state.blockedUntil > now) {
        return {
          ok: false,
          code: 'PASSWORD_ATTEMPTS_EXCEEDED',
          message: '密码尝试次数过多，请稍后再试',
          retryAfterMs: state.blockedUntil - now,
        }
      }
      return {
        ok: false,
        code: password ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED',
        message: password ? '房间密码错误' : '加入密码房必须提供 password',
      }
    }

    this.roomPasswordAttempts.delete(key)
    this.telemetry.incrementCounter('room.password.accepted')
    return { ok: true }
  }

  private configureCombatProtocol(socket: Socket, roomId: string, enabled: boolean) {
    socket.data.combatEventBatchEnabled = enabled
    socket.data.combatEventAckSeq = 0
    if (enabled) socket.join(combatProtocolRoom(roomId))
    else socket.leave(combatProtocolRoom(roomId))
  }

  private emitJoinSnapshot(socket: Socket, runtime: RoomRuntime, assignedSlot: string, reconnected = false) {

    const joinPayload = {
      roomId: runtime.room.id,
      slot: assignedSlot,
      phase: runtime.room.getPhase(),
      hostPlayerId: runtime.room.getHostPlayerId(),
      reconnected,
    }

    socket.emit('ROOM_JOINED', joinPayload)

    const fullEnvelope = this.createFullEnvelope(socket, runtime, true)

    socket.emit('TICK_UPDATE', fullEnvelope)
    socket.emit('ROOM_SNAPSHOT', this.serializeRoomSummary(runtime))
    socket.emit('ROOM_PHASE_CHANGED', { phase: runtime.room.getPhase() })
    this.recordOutbound('socket.TICK_UPDATE.full', fullEnvelope, 1)
  }

  private handleFullStateRequest(socket: Socket) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    const fullEnvelope = this.createFullEnvelope(socket, joinedContext.runtime)

    socket.emit('TICK_UPDATE', fullEnvelope)
    this.recordOutbound('socket.TICK_UPDATE.resync', fullEnvelope, 1)
  }

  private createFullEnvelope(socket: Socket, runtime: RoomRuntime, initializeBroadcastBaseline = false) {
    const fullState = runtime.projectedTickStream.getCurrentFullState({ initializeBroadcastBaseline })
    if (!socket.data.combatEventBatchEnabled) {
      return { mode: 'full' as const, gameState: fullState, sentAt: Date.now() }
    }
    const cursor = runtime.projectedTickStream.getPresentationCursor()
    return {
      mode: 'full' as const,
      gameState: detachCombatEvents(fullState),
      sentAt: Date.now(),
      revision: fullState.tick,
      presentationVersion: COMBAT_PRESENTATION_VERSION,
      eventSeq: cursor.matchId === fullState.matchId ? cursor.eventSeq : 0,
      eventsDetached: true,
    }
  }

  private handleCombatEventAck(socket: Socket, payload: unknown) {
    if (!socket.data.combatEventBatchEnabled || !payload || typeof payload !== 'object') return
    const ack = payload as Partial<CombatEventAck>
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext || ack.presentationVersion !== COMBAT_PRESENTATION_VERSION) return
    const cursor = joinedContext.runtime.projectedTickStream.getPresentationCursor()
    if (ack.matchId !== cursor.matchId || !Number.isSafeInteger(ack.ackSeq) || (ack.ackSeq as number) < 0) return
    socket.data.combatEventAckSeq = Math.max(socket.data.combatEventAckSeq ?? 0, ack.ackSeq as number)
  }

  private handleCombatEventReplayRequest(socket: Socket, payload: unknown) {
    if (!socket.data.combatEventBatchEnabled || !payload || typeof payload !== 'object') return
    const request = payload as Partial<CombatEventReplayRequest>
    const joinedContext = this.getJoinedContext(socket)
    if (
      !joinedContext
      || request.presentationVersion !== COMBAT_PRESENTATION_VERSION
      || !Number.isSafeInteger(request.fromSeq)
      || (request.fromSeq as number) < 1
    ) return
    const cursor = joinedContext.runtime.projectedTickStream.getPresentationCursor()
    if (request.matchId !== cursor.matchId) {
      this.handleFullStateRequest(socket)
      return
    }
    const batch = joinedContext.runtime.projectedTickStream.getCombatEventBatchAfter(request.fromSeq as number)
    if (batch) {
      socket.emit('COMBAT_EVENT_BATCH', batch)
      this.recordOutbound('socket.COMBAT_EVENT_BATCH.replay', batch, 1)
      return
    }
    socket.emit('COMBAT_EVENT_RESET', {
      matchId: cursor.matchId,
      presentationVersion: COMBAT_PRESENTATION_VERSION,
      eventSeq: cursor.eventSeq,
      reason: 'retention_gap',
    })
    this.handleFullStateRequest(socket)
  }

  private async handleActionSubmission(socket: Socket, payload: unknown) {
    const requestId = typeof payload === 'object' && payload !== null && 'requestId' in payload
      && typeof (payload as { requestId?: unknown }).requestId === 'string'
      ? (payload as { requestId: string }).requestId
      : null
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间', undefined, requestId)
      return
    }

    let submission
    try {
      const state = joinedContext.room.engine.getStateSnapshot()
      submission = this.checkpointCoordinator && state.status === 'running' && state.pve
        ? await submitDurablePveAction({
            engine: joinedContext.room.engine, room: joinedContext.room,
            checkpointCoordinator: this.checkpointCoordinator,
            limiter: this.actionLimiter, player: joinedContext.identity, payload,
          })
        : submitAction({ engine: joinedContext.room.engine, limiter: this.actionLimiter, player: joinedContext.identity, payload })
    }
    catch {
      this.emitEngineError(socket, 'PVE_PERSISTENCE_UNAVAILABLE', '权威对局持久化暂不可用，请勿重试新 requestId', undefined, requestId)
      return
    }

    if (!submission.ok) {
      this.emitEngineError(socket, submission.code, submission.message, submission.retryAfterMs, requestId)
      return
    }

    const acceptedPayload = {
      ok: true,
      action: submission.action,
      requestId: submission.requestId,
      actionId: submission.actionId,
      serverTick: submission.serverTick,
      rateLimitRemaining: submission.rateLimitRemaining,
      duplicate: submission.duplicate,
    }

    socket.emit('ACTION_ACCEPTED', acceptedPayload)
    socket.emit('action_accepted', acceptedPayload)
  }

  private handleBuildTower(socket: Socket, payload: unknown) {
    if (!isBuildTowerPayload(payload)) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 x、y、towerType')
      return
    }

    void this.handleActionSubmission(socket, {
      action: 'BUILD_TOWER',
      x: payload.x,
      y: payload.y,
      type: payload.towerType,
    })
  }

  private handleStartMatch(socket: Socket) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    void this.beginRoomCountdown(joinedContext, socket)
  }

  private async handleSelectLevel(socket: Socket, payload: unknown) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    if (joinedContext.identity.playerId !== joinedContext.room.getHostPlayerId()) {
      this.emitEngineError(socket, 'FORBIDDEN', '只有房主有权选择难度')
      return
    }

    const selection = parseStageSelection(payload)
    if (!selection) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少或无效的 levelId、difficulty')
      return
    }

    const levelConfig = LEVEL_CONFIGS[selection.levelId]
    if (!levelConfig) {
      this.emitEngineError(socket, 'INVALID_LEVEL', `Level ${selection.levelId} 不存在`)
      return
    }

    if (!this.accountService) {
      this.emitEngineError(socket, 'ACCOUNT_SERVICE_UNAVAILABLE', '关卡进度服务暂不可用')
      return
    }

    const participantIds = joinedContext.room.getConnectedPlayerIds()
    const participantAccounts = await Promise.all(participantIds.map(playerId => this.accountService!.getOrCreate(playerId)))
    const lockedParticipant = participantAccounts.find(account => !checkPveStageUnlock(account.pveProgress, selection).allowed)
    if (lockedParticipant) {
      const unlockResult = checkPveStageUnlock(lockedParticipant.pveProgress, selection)
      this.emitEngineError(socket, 'LEVEL_LOCKED', `玩家 ${lockedParticipant.playerId} 未解锁：${unlockResult.allowed ? '前置不满足' : unlockResult.reason}`)
      return
    }

    if (!levelConfig.allowedPlayerKinds.includes(joinedContext.identity.playerKind)) {
      this.emitEngineError(socket, 'LEVEL_LOCKED', '当前玩家类型不允许进入该关卡')
      return
    }

    const currentPhase = joinedContext.room.getPhase()
    if (currentPhase === 'playing') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前对局已开始，不能再次选择难度')
      return
    }

    if (currentPhase === 'lobby' || currentPhase === 'countdown') {
      joinedContext.room.setPendingStageSelection(selection)

      if (currentPhase === 'lobby') {
        void this.beginRoomCountdown(joinedContext, socket)
      }

      return
    }

    if (currentPhase !== 'waiting_for_level') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前状态不接受难度选择，请等待倒计时完成')
      return
    }

    await this.activateRoomLevel(joinedContext.room, levelConfig, selection)
  }

  private async beginRoomCountdown(joinedContext: JoinedRoomContext, socket: Socket) {
    const result = await joinedContext.room.beginCountdown(joinedContext.identity.playerId, () => {
      this.handleCountdownCompleted(joinedContext.room)
    })

    if (result === 'forbidden') {
      this.emitEngineError(socket, 'FORBIDDEN', '只有房主可以启动游戏')
      return false
    }

    if (result === 'wrong_phase') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前房间状态不允许启动该操作')
      return false
    }

    if (result === 'snapshot_failed') {
      this.emitEngineError(socket, 'BUILD_SNAPSHOT_FAILED', '局外构筑锁定失败，对局未启动，请重试')
      return false
    }

    const countdownPayload = {
      phase: 'countdown' as const,
      durationMs: COUNTDOWN_DURATION_MS,
      remainingSeconds: COUNTDOWN_DURATION_MS / 1000,
    }

    this.io.to(joinedContext.room.id).emit('START_MATCH_ACCEPTED', countdownPayload)
    this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', countdownPayload)
    this.emitRoomSnapshot(joinedContext.room)
    this.scheduleCountdownBroadcast(joinedContext.room)
    return true
  }

  private handleCountdownCompleted(room: Room) {
    const pendingSelection = room.consumePendingStageSelection()
    if (pendingSelection === null) {
      this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'waiting_for_level' as const })
      this.emitRoomSnapshot(room)
      return
    }

    const levelConfig = LEVEL_CONFIGS[pendingSelection.levelId]
    if (!levelConfig) {
      this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'waiting_for_level' as const })
      return
    }

    void this.activateRoomLevel(room, levelConfig, pendingSelection).catch(() => undefined)
  }

  private async activateRoomLevel(
    room: Room,
    levelConfig: (typeof LEVEL_CONFIGS)[number],
    selection: PveStageSelection,
  ) {
    room.ignitePveV2(selection)
    if (this.checkpointCoordinator) await this.checkpointCoordinator.attachFreshRoom(room)

    const levelSelectedPayload = {
      levelId: levelConfig.levelId,
      difficulty: selection.difficulty,
      label: levelConfig.label,
      description: levelConfig.description,
      targetClearRate: levelConfig.targetClearRate,
      waveCount: levelConfig.waves.length,
      minPlayers: levelConfig.minPlayers,
    }

    this.io.to(room.id).emit('LEVEL_SELECTED', levelSelectedPayload)
    this.io.to(room.id).emit('ROOM_PHASE_CHANGED', { phase: 'playing', levelId: levelConfig.levelId })
    this.emitRoomSnapshot(room)
  }

  private scheduleCountdownBroadcast(room: Room) {
    const countdownSeconds = [2, 1]

    countdownSeconds.forEach((remainingSeconds) => {
      setTimeout(() => {
        if (room.getPhase() !== 'countdown') {
          return
        }

        this.io.to(room.id).emit('COUNTDOWN_TICK', {
          phase: 'countdown',
          remainingSeconds,
          remainingMs: remainingSeconds * 1000,
        })
      }, (COUNTDOWN_DURATION_MS / 1000 - remainingSeconds) * 1000)
    })
  }

  private ensureRoomRuntime(roomId: string) {
    const existingRuntime = this.roomRuntimes.get(roomId)
    if (existingRuntime) {
      return existingRuntime
    }

    const room = this.roomManager.getOrCreateRoom(roomId)
    const usesSharedProjectedTickStream = roomId === DEFAULT_ROOM_ID && Boolean(this.defaultProjectedTickStream)
    const projectedTickStream = usesSharedProjectedTickStream
      ? this.defaultProjectedTickStream as ProjectedTickStream
      : new ProjectedTickStream(room.engine, this.config, this.telemetry)
    const loop = new GameLoop(room.engine, this.config.hostLoopIntervalMs)
    room.engine.attachPerformanceTelemetry(this.telemetry)

    let runtime!: RoomRuntime
    const reconnectRegistry = new PlayerReconnectRegistry({
      graceMs: this.config.disconnectGraceMs,
      onGraceStarted: (pending) => this.handleReconnectGraceStarted(runtime, pending),
      onExpired: (pending) => this.finalizeExpiredPlayer(runtime, pending),
    })
    runtime = {
      room,
      loop,
      projectedTickStream,
      reconnectRegistry,
      ownsProjectedTickStream: !usesSharedProjectedTickStream,
      unsubscribeProjection: () => {},
      unsubscribeSettlement: () => {},
      rewardQueue: Promise.resolve(),
      settledMatchIds: new Set(),
      scheduledRewardKeys: new Set(),
      scheduledDepartures: new Set(),
      settlementTelemetry: null,
    }

    runtime.unsubscribeSettlement = room.engine.onTick((state) => {
      if (state.pve) {
        if (runtime.settlementTelemetry?.matchId !== state.matchId) {
          runtime.settlementTelemetry = createSettlementTelemetry(state.matchId)
        }
        ingestSettlementEvents(runtime.settlementTelemetry, state.pve.recentEvents)
      }
      this.schedulePveRewardWork(runtime, state)
    }, { label: 'pve-reward-settlement' })

    runtime.unsubscribeProjection = projectedTickStream.subscribeBroadcast((event) => {
      const recipientCount = this.io.sockets.adapter.rooms.get(room.id)?.size ?? 0
      if (recipientCount === 0) {
        return
      }

      if (!event.shouldSocketBroadcast || !event.broadcast) {
        return
      }

      const protocolRoom = combatProtocolRoom(room.id)
      const protocolRecipientCount = this.io.sockets.adapter.rooms.get(protocolRoom)?.size ?? 0
      const legacyRecipientCount = Math.max(0, recipientCount - protocolRecipientCount)
      const mode = event.shouldFullSnapshot ? 'checkpoint' as const : 'patch' as const
      const legacyPatch = event.shouldFullSnapshot ? event.broadcast.checkpoint : event.broadcast.legacyPatch
      const protocolPatch = event.shouldFullSnapshot
        ? detachCombatEvents(event.broadcast.checkpoint)
        : event.broadcast.patch
      const sentAt = Date.now()

      if (legacyRecipientCount > 0) {
        const legacyEnvelope = { mode, patch: legacyPatch, sentAt }
        this.io.to(room.id).except(protocolRoom).emit('TICK_UPDATE', legacyEnvelope)
        this.recordOutbound(`socket.TICK_UPDATE.${mode}.legacy`, legacyEnvelope, legacyRecipientCount)
      }
      if (protocolRecipientCount > 0) {
        const protocolEnvelope = {
          mode,
          patch: protocolPatch,
          sentAt,
          revision: event.broadcast.patch.tick,
          baseRevision: event.broadcast.baseRevision,
          eventsDetached: true,
        }
        this.io.to(protocolRoom).emit('TICK_UPDATE', protocolEnvelope)
        this.recordOutbound(`socket.TICK_UPDATE.${mode}.v2`, protocolEnvelope, protocolRecipientCount)
        if (event.broadcast.combatEventBatch) {
          this.io.to(protocolRoom).emit('COMBAT_EVENT_BATCH', event.broadcast.combatEventBatch)
          this.recordOutbound('socket.COMBAT_EVENT_BATCH', event.broadcast.combatEventBatch, protocolRecipientCount)
        }
      }

      if (Object.keys(event.broadcast.uiUpdate).length > 0) {
        this.io.to(room.id).emit('UI_STATE_UPDATE', event.broadcast.uiUpdate)
        this.recordOutbound('socket.UI_STATE_UPDATE', event.broadcast.uiUpdate, recipientCount)
      }

      if (event.broadcast.noticeUpdate) {
        this.io.to(room.id).emit('NOTICE_UPDATE', event.broadcast.noticeUpdate)
        this.recordOutbound('socket.NOTICE_UPDATE', event.broadcast.noticeUpdate, recipientCount)
      }
    })

    if (this.roomLoopsStarted) loop.start()
    this.roomRuntimes.set(roomId, runtime)
    return runtime
  }

  private schedulePveRewardWork(runtime: RoomRuntime, state: GameState) {
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    if (!selection || !state.pve || !this.accountService) return
    const milestones = [5, 10, 15, 20] as const
    const dueMilestones = state.pve.players.flatMap(player => milestones
      // 波次允许重叠，后续波次先清完不能被误判为前一个 Boss 已死亡。
      .filter(milestone => player.clearedWaves.includes(milestone))
      .map(milestone => ({ playerId: player.playerId, milestone })))
      .filter(({ playerId, milestone }) => !runtime.scheduledRewardKeys.has(
        `${state.matchId}:${playerId}:wave-${milestone}`,
      ))
    const needsSettlement = state.status === 'finished' && !runtime.settledMatchIds.has(state.matchId)
      && !runtime.scheduledRewardKeys.has(`${state.matchId}:settlement`)
    if (dueMilestones.length === 0 && !needsSettlement) return

    for (const due of dueMilestones) {
      runtime.scheduledRewardKeys.add(`${state.matchId}:${due.playerId}:wave-${due.milestone}`)
    }
    if (needsSettlement) runtime.scheduledRewardKeys.add(`${state.matchId}:settlement`)
    const stateSnapshot = structuredClone(state)
    runtime.rewardQueue = runtime.rewardQueue
      .then(async () => {
        const milestoneResults = await Promise.allSettled(dueMilestones.map(due => (
          this.recordPveMilestone(runtime, stateSnapshot, due.playerId, due.milestone)
        )))
        const milestoneFailures: string[] = []
        milestoneResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const due = dueMilestones[index]
            runtime.scheduledRewardKeys.delete(`${state.matchId}:${due.playerId}:wave-${due.milestone}`)
            milestoneFailures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
          }
        })
        if (milestoneFailures.length > 0) throw new Error(milestoneFailures.join(', '))
        if (needsSettlement) await this.settleFinishedPveMatch(runtime, stateSnapshot)
      })
      .catch((error) => {
        if (needsSettlement) runtime.scheduledRewardKeys.delete(`${state.matchId}:settlement`)
        const details = error instanceof Error ? error.message : String(error)
        console.error(`PVE reward processing failed for ${state.matchId}: ${details}`)
      })
  }

  private async recordPveMilestone(
    runtime: RoomRuntime,
    state: GameState,
    playerId: string,
    milestone: 5 | 10 | 15 | 20,
  ) {
    if (!this.accountService) throw new Error('PLAYER_ACCOUNT_SERVICE_NOT_CONFIGURED')
    const pve = state.pve
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    const stage = selection ? getPveStageDefinition(selection.levelId) : null
    const player = pve?.players.find(candidate => candidate.playerId === playerId)
    if (!selection || !stage || !player || !pve || !isPveDifficulty(selection.difficulty)) {
      throw new Error('PVE_REWARD_CONTEXT_INCOMPLETE')
    }
    const account = await this.accountService.getOrCreate(playerId)
    await this.pveRewardService.recordWaveMilestone({
      matchId: state.matchId,
      matchSeed: state.matchId,
      combatRulesetVersion: pve.combatRulesetVersion,
      configSnapshot: pve.configSnapshot,
      stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
      playerId,
      milestone,
      activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
      discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
      weaponState: {
        fragmentBalances: account.weapon.fragmentBalances,
        unlockedWeaponIds: account.weapon.unlockedWeaponIds,
      },
      bossFragmentBonus: this.resolveBossFragmentBonus(runtime.room, playerId),
    })
  }

  private resolveBossFragmentBonus(room: Room, playerId: string) {
    const build = room.getMatchBuildSnapshot(playerId)
    if (!build) return undefined
    for (const itemId of build.item.passiveSlots) {
      if (!itemId) continue
      const definition = getPassiveItemDefinition(itemId)
      const modifier = definition?.ruleModifiers.find(candidate => candidate.type === 'boss_fragment_bonus')
      if (modifier?.type === 'boss_fragment_bonus') {
        return {
          chanceBps: modifier.chanceBps,
          extraCount: modifier.extraCount,
          maxExtraPerBoss: modifier.maxExtraPerBoss,
          qualityPolicy: modifier.qualityPolicy,
        } as const
      }
    }
    return undefined
  }

  private async settleFinishedPveMatch(runtime: RoomRuntime, state: GameState) {
    if (!this.accountService || !state.pve || !state.result) return
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    const stage = selection ? getPveStageDefinition(selection.levelId) : null
    if (!selection || !stage) throw new Error('PVE_SETTLEMENT_CONTEXT_INCOMPLETE')
    const officialVictory = state.result.outcome === 'victory'
    const failures: string[] = []

    for (const player of state.pve.players) {
      try {
        const account = await this.accountService.getOrCreate(player.playerId)
        if (account.settlementsById[`${state.matchId}:${player.playerId}`]) continue
        const rewardContext = {
          matchId: state.matchId,
          matchSeed: state.matchId,
          combatRulesetVersion: state.pve.combatRulesetVersion,
          configSnapshot: state.pve.configSnapshot,
          stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
          playerId: player.playerId,
          activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
          discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
          weaponState: {
            fragmentBalances: account.weapon.fragmentBalances,
            unlockedWeaponIds: account.weapon.unlockedWeaponIds,
          },
        } as const
        await this.pveRewardService.recordMatchOutcome({ ...rewardContext, officialVictory })
        const frozenRewards = await this.pveRewardService.freezePlayerRewards(state.matchId, player.playerId)
        const rewardEvents = (await this.pveRewardService.store.listPlayerBatches(state.matchId, player.playerId))
          .flatMap(batch => batch.events)
        const telemetry = runtime.settlementTelemetry?.matchId === state.matchId
          ? runtime.settlementTelemetry : createSettlementTelemetry(state.matchId)
        const allStats = resolveSettlementStats(telemetry, state.pve.players)
        const detail = buildPveSettlementDetail({
          configSnapshot: state.pve.configSnapshot,
          rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
          reason: officialVictory ? 'victory' : 'defeat',
          officialVictory,
          highestCompletedWave: player.highestCompletedWave,
          player,
          allStats,
          coverageComplete: telemetry.sawMatchStarted,
          rewardEvents,
          firstClear: officialVictory && !account.pveProgress.clearsByStageKey[pveStageKey(selection)],
        })
        if (!this.settlementCoordinator || !state.pve.configSnapshot) {
          throw new Error('PVE_SETTLEMENT_COORDINATOR_NOT_CONFIGURED')
        }
        await this.settlementCoordinator.settle({
          settlementId: `${state.matchId}:${player.playerId}`,
          combatRulesetVersion: state.pve.combatRulesetVersion,
          configSnapshot: state.pve.configSnapshot,
          rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
          detail,
          input: {
            requestId: `settle:${state.matchId}:${player.playerId}`,
            matchId: state.matchId,
            playerId: player.playerId,
            reason: officialVictory ? 'victory' : 'defeat',
            highestCompletedWave: player.highestCompletedWave,
            officialVictory,
            retainedWeaponFragments: frozenRewards.fragmentBalances,
            stageSelection: selection,
          },
        })
      }
      catch (error) {
        failures.push(`${player.playerId}:${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length > 0) throw new Error(failures.join(', '))
    runtime.settledMatchIds.add(state.matchId)
  }

  private async settleDepartingPvePlayer(runtime: RoomRuntime, playerId: string, frozenState?: GameState) {
    if (!this.accountService) return
    const state = frozenState ?? runtime.room.engine.getStateSnapshot()
    const pve = state.pve
    const selection = runtime.room.getStageSelectionForMatch(state.matchId)
    const stage = selection ? getPveStageDefinition(selection.levelId) : null
    const player = pve?.players.find(candidate => candidate.playerId === playerId)
    if (state.status !== 'running' || !selection || !stage || !player || !pve) return
    const account = await this.accountService.getOrCreate(playerId)
    if (account.settlementsById[`${state.matchId}:${playerId}`]) return
    for (const milestone of [5, 10, 15, 20] as const) {
      if (player.clearedWaves.includes(milestone)) {
        await this.recordPveMilestone(runtime, state, playerId, milestone)
      }
    }
    await this.pveRewardService.recordMatchOutcome({
      matchId: state.matchId,
      matchSeed: state.matchId,
      combatRulesetVersion: pve.combatRulesetVersion,
      configSnapshot: pve.configSnapshot,
      stage: { levelId: selection.levelId, stageId: stage.stageId, difficulty: selection.difficulty },
      playerId,
      activatedGeneralIds: player.generalProgress.map(progress => progress.generalId),
      discoveredGeneralIds: Object.keys(account.weapon.loadoutsByGeneralId),
      weaponState: {
        fragmentBalances: account.weapon.fragmentBalances,
        unlockedWeaponIds: account.weapon.unlockedWeaponIds,
      },
      officialVictory: false,
    })
    const frozenRewards = await this.pveRewardService.freezePlayerRewards(state.matchId, playerId)
    const rewardEvents = (await this.pveRewardService.store.listPlayerBatches(state.matchId, playerId))
      .flatMap(batch => batch.events)
    const telemetry = runtime.settlementTelemetry?.matchId === state.matchId
      ? runtime.settlementTelemetry : createSettlementTelemetry(state.matchId)
    const allStats = resolveSettlementStats(telemetry, pve.players)
    const detail = buildPveSettlementDetail({
      configSnapshot: pve.configSnapshot,
      rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
      reason: 'disconnect_exit',
      officialVictory: false,
      highestCompletedWave: player.highestCompletedWave,
      player,
      allStats,
      coverageComplete: telemetry.sawMatchStarted,
      rewardEvents,
      firstClear: false,
    })
    if (!this.settlementCoordinator) {
      throw new Error('PVE_SETTLEMENT_COORDINATOR_NOT_CONFIGURED')
    }
    await this.settlementCoordinator.settle({
      settlementId: `${state.matchId}:${playerId}`,
      combatRulesetVersion: pve.combatRulesetVersion,
      configSnapshot: pve.configSnapshot,
      rewardTableRevision: PVE_WEAPON_REWARD_TABLE_REVISION,
      detail,
      input: {
        requestId: `settle:${state.matchId}:${playerId}`,
        matchId: state.matchId,
        playerId,
        reason: 'disconnect_exit',
        highestCompletedWave: player.highestCompletedWave,
        officialVictory: false,
        retainedWeaponFragments: frozenRewards.fragmentBalances,
        stageSelection: selection,
      },
    })
  }

  private leaveJoinedRoom(socket: Socket) {
    const roomId = this.getJoinedRoomId(socket)
    const identity = this.getJoinedIdentity(socket)
    if (!roomId || !identity) {
      return
    }

    const runtime = this.roomRuntimes.get(roomId)
    if (!runtime) {
      delete socket.data.roomId
      delete socket.data.identity
      return
    }

    const generation = typeof socket.data.connectionGeneration === 'number'
      ? socket.data.connectionGeneration
      : -1
    runtime.reconnectRegistry.detach(identity.playerId, socket.id, generation)

    socket.leave(roomId)
    socket.leave(combatProtocolRoom(roomId))
    delete socket.data.roomId
    delete socket.data.identity
    delete socket.data.connectionGeneration
    delete socket.data.combatEventBatchEnabled
    delete socket.data.combatEventAckSeq
  }

  private handleReconnectGraceStarted(runtime: RoomRuntime, pending: PendingPlayerDisconnect) {
    runtime.room.engine.markPlayerReconnecting(pending.playerId)
    this.emitPlayerConnectionState(runtime, pending.playerId, 'reconnecting', pending.deadlineAt)
    this.emitRoomSnapshot(runtime)
  }

  private finalizeExpiredPlayer(runtime: RoomRuntime, pending: PendingPlayerDisconnect) {
    // 在宽限到期这一刻冻结结算事实，避免排队期间对局结束改变离场原因。
    const state = runtime.room.engine.getStateSnapshot()
    const departureKey = `${state.matchId}:${pending.playerId}`
    if (runtime.scheduledDepartures.has(departureKey)) return
    runtime.scheduledDepartures.add(departureKey)
    runtime.room.engine.markPlayerDisconnected(pending.playerId)
    this.emitPlayerConnectionState(runtime, pending.playerId, 'disconnected', null)
    this.emitRoomSnapshot(runtime)

    runtime.rewardQueue = runtime.rewardQueue
      .then(() => this.settleDepartingPvePlayer(runtime, pending.playerId, state))
      .catch((error) => {
        console.error(`PVE disconnect settlement failed for ${pending.playerId}: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        runtime.room.leavePlayer(pending.playerId)
        runtime.reconnectRegistry.completeDeparture(pending.playerId)
        this.emitRoomSnapshot(runtime)
        this.cleanupRoomIfEmpty(runtime.room.id)
      })
  }

  private invalidateSupersededSocket(roomId: string, playerId: string, socketId: string) {
    const superseded = this.io.sockets.sockets.get(socketId)
    if (!superseded) return
    superseded.emit('PLAYER_CONNECTION_REPLACED', { playerId, replacementReason: 'newer_authenticated_socket' })
    superseded.leave(roomId)
    superseded.leave(combatProtocolRoom(roomId))
    delete superseded.data.roomId
    delete superseded.data.identity
    delete superseded.data.connectionGeneration
  }

  private emitPlayerConnectionState(
    runtime: RoomRuntime,
    playerId: string,
    status: 'connected' | 'reconnecting' | 'disconnected',
    reconnectDeadlineAt: number | null,
  ) {
    const remainingMs = reconnectDeadlineAt === null ? 0 : Math.max(0, reconnectDeadlineAt - Date.now())
    this.io.to(runtime.room.id).emit('PLAYER_CONNECTION_STATE', {
      playerId,
      status,
      reconnectDeadlineAt,
      reconnectRemainingMs: remainingMs,
      graceMs: this.config.disconnectGraceMs,
    })
  }

  private cleanupRoomIfEmpty(roomId: string) {
    const runtime = this.roomRuntimes.get(roomId)
    if (!runtime || !runtime.room.isEmpty()) {
      return
    }

    runtime.reconnectRegistry.shutdown()

    runtime.unsubscribeProjection()
    runtime.unsubscribeSettlement()
    if (runtime.ownsProjectedTickStream) {
      runtime.projectedTickStream.dispose()
    }
    runtime.loop.stop()
    this.roomRuntimes.delete(roomId)
    this.roomManager.removeRoom(roomId)
  }

  private getJoinedContext(socket: Socket) {
    const roomId = this.getJoinedRoomId(socket)
    const identity = this.getJoinedIdentity(socket)
    if (!roomId || !identity) {
      return null
    }

    const runtime = this.roomRuntimes.get(roomId)
    if (!runtime) {
      return null
    }
    const generation = typeof socket.data.connectionGeneration === 'number'
      ? socket.data.connectionGeneration
      : -1
    if (!runtime.reconnectRegistry.isCurrent(identity.playerId, socket.id, generation)) {
      return null
    }

    return {
      room: runtime.room,
      runtime,
      identity,
    }
  }

  private getJoinedRoomId(socket: Socket) {
    return typeof socket.data.roomId === 'string' ? socket.data.roomId : null
  }

  private getJoinedIdentity(socket: Socket): PlayerIdentity | null {
    const identity = socket.data.identity
    if (!identity || typeof identity !== 'object') {
      return null
    }

    const candidate = identity as Partial<PlayerIdentity>
    if (
      typeof candidate.playerId !== 'string'
      || typeof candidate.playerName !== 'string'
      || (candidate.playerKind !== 'human' && candidate.playerKind !== 'agent')
    ) {
      return null
    }

    return candidate as PlayerIdentity
  }

  private resolvePlayerIdentity(socket: Socket, overrides?: Partial<JoinRoomPayload>): PlayerIdentity {
    const principal = socket.data.principal as GatewayPrincipal | undefined
    const requestedPlayerId = overrides?.playerId ?? readHandshakeValue(socket, 'playerId')
    const requestedPlayerName = overrides?.playerName ?? readHandshakeValue(socket, 'playerName')
    const isSupabaseSession = principal?.authSource === 'supabase'
    const playerId = isSupabaseSession
      ? principal?.playerId ?? requestedPlayerId ?? socket.id
      : requestedPlayerId ?? principal?.playerId ?? socket.id
    const playerName = isSupabaseSession
      ? principal?.playerName ?? requestedPlayerName ?? `player-${playerId.slice(0, 6)}`
      : requestedPlayerName ?? principal?.playerName ?? `player-${playerId.slice(0, 6)}`
    const playerKind = principal?.playerKind ?? overrides?.playerKind ?? (readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human')

    return {
      playerId,
      playerName,
      playerKind,
    }
  }

  private serializeRoomSummary(runtime: RoomRuntime): SerializedRoomSummary {
    const summary = runtime.room.getSummary()
    return {
      id: summary.id,
      name: summary.name,
      hasPassword: summary.hasPassword,
      players: summary.players,
      maxPlayers: summary.maxPlayers,
      status: summary.phase === 'playing'
        ? 'IN_MATCH'
        : summary.phase === 'countdown' || summary.phase === 'waiting_for_level'
          ? 'DRAFTING'
          : 'OPEN',
      pingMs: null,
      slots: summary.slots.map((slot) => {
        const pending = slot.playerId ? runtime.reconnectRegistry.getPending(slot.playerId) : null
        return pending
          ? {
              ...slot,
              reconnectDeadlineAt: pending.deadlineAt,
              reconnectRemainingMs: Math.max(0, pending.deadlineAt - Date.now()),
            }
          : slot
      }),
    }
  }

  private emitRoomSnapshot(value: Room | RoomRuntime) {
    const runtime = 'room' in value ? value : this.roomRuntimes.get(value.id)
    if (!runtime) return
    this.io.to(runtime.room.id).emit('ROOM_SNAPSHOT', this.serializeRoomSummary(runtime))
  }

  private emitEngineError(socket: Socket, code: string, message: string, retryAfterMs?: number, requestId?: string | null) {
    socket.emit('engine_error', {
      code,
      message,
      retryAfterMs,
      ...(requestId ? { requestId } : {}),
    })
  }

  private recordOutbound(metricName: string, payload: unknown, recipientCount: number) {
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    this.telemetry.incrementCounter(`${metricName}.messages`, 1)
    this.telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes * recipientCount)
    this.telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes)
  }
}
