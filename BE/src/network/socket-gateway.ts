import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { Room } from '../core/Room'
import { projectFrontendGameState } from '../core/state-projection'
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

  constructor(
    httpServer: HttpServer,
    room: Room,
    config: ServerConfig,
    private readonly actionLimiter: ActionRateLimiter,
  ) {
    this.config = config
    this.room = room
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

    this.room.engine.onTick((state) => {
      this.io.emit('tick_update', projectFrontendGameState(state, this.config))
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

    socket.emit('room_joined', {
      roomId: this.room.id,
      slot: assignedSlot,
    })
    socket.emit('tick_update', projectFrontendGameState(this.room.engine.getStateSnapshot(), this.config))

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
}