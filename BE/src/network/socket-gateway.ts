import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { Room } from '../core/Room'
import { projectFrontendGameState, projectFrontendGameStatePatch, projectFrontendNoticeUpdate, projectFrontendUiStateUpdate } from '../core/state-projection'
import type { PlayerIdentity } from '../domain/actions'
import type { ServerConfig } from '../config/server-config'
import type { FrontendGameState } from '../domain/frontend-game-state'
import type { GameNoticeUpdate, GameStatePatch, GameUiStateUpdate } from '../../../shared/contracts/game'
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

  private readonly broadcastEveryTicks: number

  private lastBroadcastState: FrontendGameState | null = null

  constructor(
    httpServer: HttpServer,
    room: Room,
    config: ServerConfig,
    private readonly actionLimiter: ActionRateLimiter,
  ) {
    this.config = config
    this.room = room
    this.broadcastEveryTicks = Math.max(1, Math.round(config.broadcastIntervalMs / Math.max(1, config.tickRateMs)))
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
      if (state.status !== 'finished' && state.tick % this.broadcastEveryTicks !== 0) {
        return
      }

      const uiUpdate = projectFrontendUiStateUpdate(state, this.config, this.lastBroadcastState)
      const noticeUpdate = projectFrontendNoticeUpdate(state, this.lastBroadcastState)
      const patch = projectFrontendGameStatePatch(state, this.config, this.lastBroadcastState)
      this.lastBroadcastState = mergeFrontendNoticeUpdate(
        mergeFrontendUiStateUpdate(
          mergeFrontendGameStatePatch(this.lastBroadcastState, patch),
          uiUpdate,
        ),
        noticeUpdate,
      )

      this.io.emit('tick_update', {
        mode: 'patch',
        patch,
      })

      if (Object.keys(uiUpdate).length > 0) {
        this.io.emit('ui_state_update', uiUpdate)
      }

      if (noticeUpdate) {
        this.io.emit('notice_update', noticeUpdate)
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

    socket.emit('room_joined', {
      roomId: this.room.id,
      slot: assignedSlot,
    })
    const fullState = projectFrontendGameState(this.room.engine.getStateSnapshot(), this.config)
    this.lastBroadcastState = fullState
    socket.emit('tick_update', {
      mode: 'full',
      gameState: fullState,
    })

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

function mergeFrontendGameStatePatch(previousState: FrontendGameState | null, patch: GameStatePatch) {
  if (!previousState) {
    return null
  }

  return {
    ...previousState,
    ...patch,
    towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
    enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
    map: patch.map ?? previousState.map,
  }
}

function mergeFrontendUiStateUpdate(previousState: FrontendGameState | null, update: GameUiStateUpdate) {
  if (!previousState) {
    return null
  }

  return {
    ...previousState,
    buildPalette: update.buildPalette ?? previousState.buildPalette,
    actionBar: update.actionBar ?? previousState.actionBar,
  }
}

function mergeFrontendNoticeUpdate(previousState: FrontendGameState | null, update: GameNoticeUpdate | null) {
  if (!previousState || !update) {
    return previousState
  }

  return {
    ...previousState,
    notices: update.notices,
  }
}

function applyEntityDelta<T extends { id: string }>(currentEntities: T[], delta?: { upsert: T[]; remove: string[] }) {
  if (!delta) {
    return currentEntities
  }

  const removeIds = new Set(delta.remove)
  const upsertById = new Map(delta.upsert.map((entity) => [entity.id, entity]))
  const nextEntities: T[] = []

  for (const entity of currentEntities) {
    if (removeIds.has(entity.id)) {
      continue
    }

    nextEntities.push(upsertById.get(entity.id) ?? entity)
    upsertById.delete(entity.id)
  }

  for (const entity of delta.upsert) {
    if (upsertById.has(entity.id)) {
      nextEntities.push(entity)
      upsertById.delete(entity.id)
    }
  }

  return nextEntities
}