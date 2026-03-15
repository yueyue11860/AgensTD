import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { parseClientAction, type PlayerIdentity } from '../domain/actions'
import { GameEngine } from '../core/game-engine'
import type { ServerConfig } from '../config/server-config'

function readHandshakeValue(socket: Socket, key: string) {
  const queryValue = socket.handshake.query[key]
  if (typeof queryValue === 'string' && queryValue.length > 0) {
    return queryValue
  }

  return undefined
}

export class SocketGateway {
  readonly io: Server

  constructor(
    httpServer: HttpServer,
    private readonly engine: GameEngine,
    config: ServerConfig,
  ) {
    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin === '*' ? true : config.corsOrigin,
        credentials: true,
      },
    })

    this.io.on('connection', (socket) => {
      this.handleConnection(socket)
    })

    this.engine.onTick((state) => {
      this.io.emit('tick_update', state)
    })
  }

  private handleConnection(socket: Socket) {
    const identity = this.resolvePlayerIdentity(socket)
    this.engine.registerPlayer(identity)

    socket.emit('tick_update', this.engine.getStateSnapshot())

    socket.on('send_action', (payload: unknown) => {
      const action = parseClientAction(payload)
      if (!action) {
        socket.emit('engine_error', { message: 'Invalid action payload' })
        return
      }

      this.engine.enqueueAction(identity, action)
    })

    socket.on('disconnect', () => {
      this.engine.markPlayerDisconnected(identity.playerId)
    })
  }

  private resolvePlayerIdentity(socket: Socket): PlayerIdentity {
    const playerId = readHandshakeValue(socket, 'playerId') ?? socket.id
    const playerName = readHandshakeValue(socket, 'playerName') ?? `player-${playerId.slice(0, 6)}`
    const playerKind = readHandshakeValue(socket, 'playerKind') === 'agent' ? 'agent' : 'human'

    return {
      playerId,
      playerName,
      playerKind,
    }
  }
}