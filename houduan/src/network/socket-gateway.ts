import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { projectFrontendGameState } from '../core/state-projection'
import type { PlayerIdentity } from '../domain/actions'
import { GameEngine } from '../core/game-engine'
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

  constructor(
    httpServer: HttpServer,
    private readonly engine: GameEngine,
    config: ServerConfig,
    private readonly actionLimiter: ActionRateLimiter,
  ) {
    this.config = config
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

    this.engine.onTick((state) => {
      this.io.emit('tick_update', projectFrontendGameState(state, this.config))
    })
  }

  private handleConnection(socket: Socket) {
    const identity = this.resolvePlayerIdentity(socket)
    this.engine.registerPlayer(identity)

    socket.emit('tick_update', projectFrontendGameState(this.engine.getStateSnapshot(), this.config))

    socket.on('send_action', (payload: unknown) => {
      const submission = submitAction({
        engine: this.engine,
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
      this.engine.markPlayerDisconnected(identity.playerId)
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