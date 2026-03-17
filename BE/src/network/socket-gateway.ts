import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { GameLoop } from '../core/game-loop'
import { ProjectedTickStream } from '../core/projected-tick-stream'
import { Room, RoomManager } from '../core/Room'
import type { PerformanceTelemetry } from '../core/performance-telemetry'
import type { GameState } from '../domain/game-state'
import type { PlayerIdentity } from '../domain/actions'
import type { ServerConfig } from '../config/server-config'
import { submitAction } from './action-submission'
import { ActionRateLimiter } from './action-rate-limiter'
import { authenticateGatewayToken, extractSocketToken, type GatewayPrincipal } from './gateway-auth'
import type { ProgressStore } from '../data/progress-store'
import type { PlayerType } from '../domain/progress'
import { checkUnlock } from '../core/unlock-logic'
import { LEVEL_CONFIGS } from '../config/level-config'

function readHandshakeValue(socket: Socket, key: string) {
  const queryValue = socket.handshake.query[key]
  if (typeof queryValue === 'string' && queryValue.length > 0) {
    return queryValue
  }

  return undefined
}

interface JoinRoomPayload {
  roomId: string
  playerId?: string
  playerName?: string
  playerKind?: 'human' | 'agent'
}

interface SelectLevelPayload {
  levelId: number
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
  playerConnections: Map<string, number>
}

interface SerializedRoomGameState {
  roomId: string
  phase: ReturnType<Room['getPhase']>
  tick: number
  status: GameState['status']
  enemies: GameState['enemies']
  towers: GameState['towers']
  gold: number
  playerGold: Array<{
    playerId: string
    slot: ReturnType<Room['getPlayerSlot']>
    gold: number
  }>
  currentWave: GameState['wave']
  overloadTicks: number
}

const DEFAULT_ROOM_ID = 'public-1'
const COUNTDOWN_DURATION_MS = 3000

function isJoinRoomPayload(payload: unknown): payload is JoinRoomPayload {
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as JoinRoomPayload).roomId === 'string'
    && (payload as JoinRoomPayload).roomId.trim().length > 0
}

function isSelectLevelPayload(payload: unknown): payload is SelectLevelPayload {
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as SelectLevelPayload).levelId === 'number'
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

  constructor(
    httpServer: HttpServer,
    roomManager: RoomManager,
    config: ServerConfig,
    private readonly telemetry: PerformanceTelemetry,
    private readonly actionLimiter: ActionRateLimiter,
    private readonly progressStore: ProgressStore,
  ) {
    this.config = config
    this.roomManager = roomManager
    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin === '*' ? true : config.corsOrigin,
        credentials: true,
      },
    })

    this.io.use((socket, next) => {
      const principal = authenticateGatewayToken(this.config, extractSocketToken(socket))
      if (!principal) {
        next(new Error('Missing or invalid gateway token'))
        return
      }

      socket.data.principal = principal
      next()
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
      this.handleJoinRoom(socket, payload)
    })

    socket.on('SEND_ACTION', (payload: unknown) => {
      this.handleActionSubmission(socket, payload)
    })

    socket.on('BUILD_TOWER', (payload: unknown) => {
      this.handleBuildTower(socket, payload)
    })

    socket.on('START_MATCH', () => {
      this.handleStartMatch(socket)
    })

    socket.on('SELECT_LEVEL', (payload: unknown) => {
      this.handleSelectLevel(socket, payload)
    })

    socket.on('disconnect', () => {
      this.leaveJoinedRoom(socket)
      this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size)
    })
  }

  shutdown(onClosed: () => void) {
    for (const runtime of this.roomRuntimes.values()) {
      runtime.unsubscribeProjection()
      runtime.loop.stop()
    }

    this.roomRuntimes.clear()
    this.io.close(onClosed)
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

      this.emitJoinSnapshot(socket, runtime, slot)
      return
    }

    if (currentRoomId && (currentRoomId !== nextRoomId || currentPlayerId !== identity.playerId)) {
      this.leaveJoinedRoom(socket)
    }

    const runtime = this.ensureRoomRuntime(nextRoomId)
    const existingConnections = runtime.playerConnections.get(identity.playerId) ?? 0
    const assignedSlot = existingConnections > 0
      ? runtime.room.getPlayerSlot(identity.playerId)
      : runtime.room.joinPlayer(identity.playerId)

    if (!assignedSlot) {
      this.emitEngineError(socket, 'ROOM_FULL', 'Room is full')
      return
    }

    runtime.playerConnections.set(identity.playerId, existingConnections + 1)
    runtime.room.engine.registerPlayer(identity)
    socket.join(nextRoomId)
    socket.data.identity = identity
    socket.data.roomId = nextRoomId

    this.emitJoinSnapshot(socket, runtime, assignedSlot)
  }

  private emitJoinSnapshot(socket: Socket, runtime: RoomRuntime, assignedSlot: string) {

    const joinPayload = {
      roomId: runtime.room.id,
      slot: assignedSlot,
      phase: runtime.room.getPhase(),
      hostPlayerId: runtime.room.getHostPlayerId(),
    }

    socket.emit('ROOM_JOINED', joinPayload)

    const fullEnvelope = {
      mode: 'full' as const,
      gameState: runtime.projectedTickStream.getCurrentFullState(),
    }

    socket.emit('TICK_UPDATE', fullEnvelope)
    const statePayload = this.serializeRoomGameState(runtime.room, runtime.room.engine.getStateSnapshot())
    socket.emit('SYNC_STATE', statePayload)
    socket.emit('GAME_STATE', statePayload)
    socket.emit('ROOM_PHASE_CHANGED', { phase: runtime.room.getPhase() })
    this.recordOutbound('socket.TICK_UPDATE.full', fullEnvelope, 1)
  }

  private handleActionSubmission(socket: Socket, payload: unknown) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    const submission = submitAction({
      engine: joinedContext.room.engine,
      limiter: this.actionLimiter,
      player: joinedContext.identity,
      payload,
    })

    if (!submission.ok) {
      this.emitEngineError(socket, submission.code, submission.message, submission.retryAfterMs)
      return
    }

    const acceptedPayload = {
      ok: true,
      action: submission.action,
      rateLimitRemaining: submission.rateLimitRemaining,
    }

    socket.emit('ACTION_ACCEPTED', acceptedPayload)
    socket.emit('action_accepted', acceptedPayload)
  }

  private handleBuildTower(socket: Socket, payload: unknown) {
    if (!isBuildTowerPayload(payload)) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 x、y、towerType')
      return
    }

    this.handleActionSubmission(socket, {
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

    const result = joinedContext.room.beginCountdown(joinedContext.identity.playerId, () => {
      const waitingPayload = { phase: 'waiting_for_level' as const }
      this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', waitingPayload)
    })

    if (result === 'forbidden') {
      this.emitEngineError(socket, 'FORBIDDEN', '只有房主可以启动游戏')
      return
    }

    if (result === 'wrong_phase') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前房间状态不允许启动该操作')
      return
    }

    const countdownPayload = {
      phase: 'countdown' as const,
      durationMs: COUNTDOWN_DURATION_MS,
      remainingSeconds: COUNTDOWN_DURATION_MS / 1000,
    }

    this.io.to(joinedContext.room.id).emit('START_MATCH_ACCEPTED', countdownPayload)
    this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', countdownPayload)
    this.scheduleCountdownBroadcast(joinedContext.room)
  }

  private handleSelectLevel(socket: Socket, payload: unknown) {
    const joinedContext = this.getJoinedContext(socket)
    if (!joinedContext) {
      this.emitEngineError(socket, 'NOT_IN_ROOM', '请先发送 JOIN_ROOM 加入房间')
      return
    }

    if (joinedContext.room.getPhase() !== 'waiting_for_level') {
      this.emitEngineError(socket, 'WRONG_PHASE', '当前状态不接受难度选择，请等待倒计时完成')
      return
    }

    if (joinedContext.identity.playerId !== joinedContext.room.getHostPlayerId()) {
      this.emitEngineError(socket, 'FORBIDDEN', '只有房主有权选择难度')
      return
    }

    if (!isSelectLevelPayload(payload)) {
      this.emitEngineError(socket, 'BAD_PAYLOAD', '缺少必要参数 levelId')
      return
    }

    const levelConfig = LEVEL_CONFIGS[payload.levelId]
    if (!levelConfig) {
      this.emitEngineError(socket, 'INVALID_LEVEL', `Level ${payload.levelId} 不存在`)
      return
    }

    const playerType: PlayerType = joinedContext.identity.playerKind === 'human' ? 'HUMAN' : 'AGENT'
    const progress = this.progressStore.getOrCreate(joinedContext.identity.playerId, playerType)
    const unlockResult = checkUnlock(progress, payload.levelId)

    if (!unlockResult.allowed) {
      this.emitEngineError(socket, 'LEVEL_LOCKED', unlockResult.reason)
      return
    }

    if (!levelConfig.allowedPlayerKinds.includes(joinedContext.identity.playerKind)) {
      this.emitEngineError(socket, 'LEVEL_LOCKED', '当前玩家类型不允许进入该关卡')
      return
    }

    if (payload.levelId === 6 && joinedContext.room.getPlayerCount() < 2) {
      this.emitEngineError(socket, 'COOP_REQUIRED', '零域裁决需至少两名物理终端协同')
      return
    }

    joinedContext.room.igniteWithLevel(levelConfig.waves, levelConfig.startingGold)

    const levelSelectedPayload = {
      levelId: levelConfig.levelId,
      label: levelConfig.label,
      description: levelConfig.description,
      targetClearRate: levelConfig.targetClearRate,
      waveCount: levelConfig.waves.length,
      minPlayers: levelConfig.minPlayers,
    }

    this.io.to(joinedContext.room.id).emit('LEVEL_SELECTED', levelSelectedPayload)
    this.io.to(joinedContext.room.id).emit('ROOM_PHASE_CHANGED', { phase: 'playing', levelId: payload.levelId })
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
    const projectedTickStream = new ProjectedTickStream(room.engine, this.config, this.telemetry)
    const loop = new GameLoop(room.engine, this.config.tickRateMs)

    const runtime: RoomRuntime = {
      room,
      loop,
      projectedTickStream,
      playerConnections: new Map(),
      unsubscribeProjection: () => {},
    }

    runtime.unsubscribeProjection = projectedTickStream.subscribeTick((event) => {
      const recipientCount = this.io.sockets.adapter.rooms.get(room.id)?.size ?? 0
      if (recipientCount === 0) {
        return
      }

      const statePayload = this.serializeRoomGameState(room, event.state)
  this.io.to(room.id).emit('SYNC_STATE', statePayload)
  this.io.to(room.id).emit('GAME_STATE', statePayload)
  this.recordOutbound('socket.SYNC_STATE', statePayload, recipientCount)
  this.recordOutbound('socket.GAME_STATE', statePayload, recipientCount)

      if (!event.shouldSocketBroadcast || !event.broadcast) {
        return
      }

      const tickEnvelope = {
        mode: 'patch' as const,
        patch: event.broadcast.patch,
      }

      this.io.to(room.id).emit('TICK_UPDATE', tickEnvelope)
      this.recordOutbound('socket.TICK_UPDATE.patch', tickEnvelope, recipientCount)

      if (Object.keys(event.broadcast.uiUpdate).length > 0) {
        this.io.to(room.id).emit('UI_STATE_UPDATE', event.broadcast.uiUpdate)
        this.recordOutbound('socket.UI_STATE_UPDATE', event.broadcast.uiUpdate, recipientCount)
      }

      if (event.broadcast.noticeUpdate) {
        this.io.to(room.id).emit('NOTICE_UPDATE', event.broadcast.noticeUpdate)
        this.recordOutbound('socket.NOTICE_UPDATE', event.broadcast.noticeUpdate, recipientCount)
      }
    })

    loop.start()
    this.roomRuntimes.set(roomId, runtime)
    return runtime
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

    const activeConnectionCount = runtime.playerConnections.get(identity.playerId) ?? 0
    if (activeConnectionCount <= 1) {
      runtime.playerConnections.delete(identity.playerId)
      runtime.room.leavePlayer(identity.playerId)
      runtime.room.engine.markPlayerDisconnected(identity.playerId)
      this.cleanupRoomIfEmpty(roomId)
    } else {
      runtime.playerConnections.set(identity.playerId, activeConnectionCount - 1)
    }

    socket.leave(roomId)
    delete socket.data.roomId
    delete socket.data.identity
  }

  private cleanupRoomIfEmpty(roomId: string) {
    const runtime = this.roomRuntimes.get(roomId)
    if (!runtime || !runtime.room.isEmpty()) {
      return
    }

    runtime.unsubscribeProjection()
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
    const playerId = principal?.playerId ?? overrides?.playerId ?? readHandshakeValue(socket, 'playerId') ?? socket.id
    const playerName = principal?.playerName ?? overrides?.playerName ?? readHandshakeValue(socket, 'playerName') ?? `player-${playerId.slice(0, 6)}`
    const playerKind = principal?.playerKind ?? overrides?.playerKind ?? (readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human')

    return {
      playerId,
      playerName,
      playerKind,
    }
  }

  private serializeRoomGameState(room: Room, state: GameState): SerializedRoomGameState {
    return {
      roomId: room.id,
      phase: room.getPhase(),
      tick: state.tick,
      status: state.status,
      enemies: state.enemies,
      towers: state.towers,
      gold: state.players.reduce((sum, player) => sum + player.gold, 0),
      playerGold: state.players.map((player) => ({
        playerId: player.id,
        slot: room.getPlayerSlot(player.id),
        gold: player.gold,
      })),
      currentWave: state.wave,
      overloadTicks: state.overloadTicks,
    }
  }

  private emitEngineError(socket: Socket, code: string, message: string, retryAfterMs?: number) {
    socket.emit('engine_error', {
      code,
      message,
      retryAfterMs,
    })
  }

  private recordOutbound(metricName: string, payload: unknown, recipientCount: number) {
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    this.telemetry.incrementCounter(`${metricName}.messages`, 1)
    this.telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes * recipientCount)
    this.telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes)
  }
}