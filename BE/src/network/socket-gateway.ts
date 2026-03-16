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