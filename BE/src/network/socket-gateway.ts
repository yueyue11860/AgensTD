import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { Room } from '../core/Room'
import type { PerformanceTelemetry } from '../core/performance-telemetry'
import type { ProjectedTickStream } from '../core/projected-tick-stream'
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

export class SocketGateway {
  readonly io: Server

  private readonly config: ServerConfig

  private readonly room: Room

  private readonly projectedTickStream: ProjectedTickStream

  constructor(
    httpServer: HttpServer,
    room: Room,
    config: ServerConfig,
    projectedTickStream: ProjectedTickStream,
    private readonly telemetry: PerformanceTelemetry,
    private readonly actionLimiter: ActionRateLimiter,
    private readonly progressStore: ProgressStore,
  ) {
    this.config = config
    this.room = room
    this.projectedTickStream = projectedTickStream
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

    this.projectedTickStream.subscribeTick((event) => {
      if (!event.shouldSocketBroadcast || !event.broadcast) {
        return
      }

      const recipientCount = this.io.sockets.sockets.size
      if (recipientCount === 0) {
        return
      }

      const tickEnvelope = {
        mode: 'patch' as const,
        patch: event.broadcast.patch,
      }

      this.io.emit('tick_update', tickEnvelope)
      this.recordOutbound('socket.tick_update.patch', tickEnvelope, recipientCount)

      if (Object.keys(event.broadcast.uiUpdate).length > 0) {
        this.io.emit('ui_state_update', event.broadcast.uiUpdate)
        this.recordOutbound('socket.ui_state_update', event.broadcast.uiUpdate, recipientCount)
      }

      if (event.broadcast.noticeUpdate) {
        this.io.emit('notice_update', event.broadcast.noticeUpdate)
        this.recordOutbound('socket.notice_update', event.broadcast.noticeUpdate, recipientCount)
      }
    })
  }

  private handleConnection(socket: Socket) {
    const identity = this.resolvePlayerIdentity(socket)
    const assignedSlot = this.room.joinPlayer(identity.playerId)
    if (!assignedSlot) {
      socket.emit('engine_error', {
        code: 'ROOM_FULL',
        message: 'Room is full',
      })
      socket.disconnect(true)
      return
    }

    this.room.engine.registerPlayer(identity)
    this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size)

    socket.emit('room_joined', {
      roomId: this.room.id,
      slot: assignedSlot,
    })
    const fullEnvelope = {
      mode: 'full',
      gameState: this.projectedTickStream.getCurrentFullState(),
    }

    socket.emit('tick_update', fullEnvelope)
    this.recordOutbound('socket.tick_update.full', fullEnvelope, 1)

    socket.on('send_action', (payload: unknown) => {
      const submission = submitAction({
        engine: this.room.engine,
        limiter: this.actionLimiter,
        player: identity,
        payload,
      })

      if (!submission.ok) {
        socket.emit('engine_error', {
          code: submission.code,
          message: submission.message,
          retryAfterMs: submission.retryAfterMs,
        })
        return
      }

      socket.emit('action_accepted', {
        ok: true,
        action: submission.action,
        rateLimitRemaining: submission.rateLimitRemaining,
      })
    })

    // ── start_game: 房主按下开始——倒计时3秒────────────────────────────────
    socket.on('start_game', () => {
      const result = this.room.beginCountdown(identity.playerId, () => {
        // 3 秒后自动切入「等待选择难度」模式，向全房广播
        this.io.emit('room_phase_changed', { phase: 'waiting_for_level' })
      })

      if (result === 'forbidden') {
        socket.emit('engine_error', {
          code: 'FORBIDDEN',
          message: '只有房主可以启动游戏',
        })
        return
      }

      if (result === 'wrong_phase') {
        socket.emit('engine_error', {
          code: 'WRONG_PHASE',
          message: '当前房间状态不允许启动该操作',
        })
        return
      }

      // 广播倒计旷开始
      this.io.emit('room_phase_changed', { phase: 'countdown', durationMs: 3000 })
    })

    // ── select_level: 房主注入难度——校验全部通过后点火引擎─────────────
    socket.on('select_level', (payload: unknown) => {
      // 1. phase 校验
      if (this.room.getPhase() !== 'waiting_for_level') {
        socket.emit('engine_error', {
          code: 'WRONG_PHASE',
          message: '当前状态不接受难度选择，请等倒计旷完成',
        })
        return
      }

      // 2. 房主权限校验
      if (identity.playerId !== this.room.getHostPlayerId()) {
        socket.emit('engine_error', {
          code: 'FORBIDDEN',
          message: '只有房主有权选择难度',
        })
        return
      }

      // 3. 解析 payload
      if (
        typeof payload !== 'object'
        || payload === null
        || typeof (payload as Record<string, unknown>).levelId !== 'number'
      ) {
        socket.emit('engine_error', {
          code: 'BAD_PAYLOAD',
          message: '缺少必要参数 levelId',
        })
        return
      }

      const levelId = (payload as Record<string, unknown>).levelId as number

      // 4. 进度/解锁校验
      const playerType: PlayerType = identity.playerKind === 'human' ? 'HUMAN' : 'AGENT'
      const progress = this.progressStore.getOrCreate(identity.playerId, playerType)
      const unlockResult = checkUnlock(progress, levelId)

      if (!unlockResult.allowed) {
        socket.emit('engine_error', {
          code: 'LEVEL_LOCKED',
          message: unlockResult.reason,
        })
        return
      }

      // 5. 隱藏关人数校验
      if (levelId === 6 && this.room.getPlayerCount() < 2) {
        socket.emit('engine_error', {
          code: 'COOP_REQUIRED',
          message: '零域裁决需至少两名物理终端协同',
        })
        return
      }

      // 6. 获取关卡配置
      const levelConfig = LEVEL_CONFIGS[levelId]
      if (!levelConfig) {
        socket.emit('engine_error', {
          code: 'INVALID_LEVEL',
          message: `Level ${levelId} 不存在`,
        })
        return
      }

      // 7. 点火引擎
      this.room.igniteWithLevel(levelConfig.waves, levelConfig.startingGold)

      // 8. 广播 LEVEL_SELECTED + 状态变化
      const levelSelectedPayload = {
        levelId: levelConfig.levelId,
        label: levelConfig.label,
        description: levelConfig.description,
        targetClearRate: levelConfig.targetClearRate,
        waveCount: levelConfig.waves.length,
        minPlayers: levelConfig.minPlayers,
      }

      this.io.emit('level_selected', levelSelectedPayload)
      this.io.emit('room_phase_changed', { phase: 'playing', levelId })
    })

    socket.on('disconnect', () => {
      this.room.leavePlayer(identity.playerId)
      this.room.engine.markPlayerDisconnected(identity.playerId)
      this.telemetry.setGauge('socket.connections', this.io.sockets.sockets.size)
    })
  }

  private resolvePlayerIdentity(socket: Socket): PlayerIdentity {
    const principal = socket.data.principal as GatewayPrincipal | undefined
    const playerId = principal?.playerId ?? readHandshakeValue(socket, 'playerId') ?? socket.id
    const playerName = principal?.playerName ?? readHandshakeValue(socket, 'playerName') ?? `player-${playerId.slice(0, 6)}`
    const playerKind = principal?.playerKind ?? (readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human')

    return {
      playerId,
      playerName,
      playerKind,
    }
  }

  private recordOutbound(metricName: string, payload: unknown, recipientCount: number) {
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    this.telemetry.incrementCounter(`${metricName}.messages`, 1)
    this.telemetry.incrementCounter(`${metricName}.bytes`, payloadBytes * recipientCount)
    this.telemetry.setGauge(`${metricName}.lastPayloadBytes`, payloadBytes)
  }
}