import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { resolveGatewayToken, resolveSocketUrl } from '../lib/runtime-config'
import type { ConnectionState, GameAction, GameNoticeUpdate, GameState, GameStatePatch, GameUiStateUpdate, TickEnvelope } from '../types/game-state'

interface OptionalIdentityOverrides {
  playerId?: string
  playerName?: string
  playerKind?: 'human' | 'agent'
}

interface UseGameEngineOptions {
  autoConnect?: boolean
  path?: string
  roomId?: string
  identity?: OptionalIdentityOverrides
  token?: string
  query?: Record<string, string | number | boolean | undefined>
}

interface UseGameEngineResult {
  socketUrl: string | null
  gameState: GameState | null
  connectionState: ConnectionState
  error: string | null
  isConnected: boolean
  lastTickAt: number | null
  lastActionAt: number | null
  sendAction: (action: GameAction) => boolean
  reconnect: () => void
}

function areCellsEqual(left: GameState['map']['cells'], right: GameState['map']['cells']) {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftCell = left[index]
    const rightCell = right[index]

    if (
      leftCell.x !== rightCell.x
      || leftCell.y !== rightCell.y
      || leftCell.kind !== rightCell.kind
      || leftCell.label !== rightCell.label
      || leftCell.walkable !== rightCell.walkable
      || leftCell.buildable !== rightCell.buildable
    ) {
      return false
    }
  }

  return true
}

function stabilizeGameState(previousState: GameState | null, nextState: GameState) {
  if (!previousState) {
    return nextState
  }

  const canReuseMap = previousState.map.width === nextState.map.width
    && previousState.map.height === nextState.map.height
    && areCellsEqual(previousState.map.cells, nextState.map.cells)

  if (!canReuseMap) {
    return nextState
  }

  return {
    ...nextState,
    map: previousState.map,
  }
}

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<GameState>
  return typeof candidate.tick === 'number'
    && typeof candidate.status === 'string'
    && Boolean(candidate.map)
    && Boolean(candidate.resources)
    && Array.isArray(candidate.towers)
    && Array.isArray(candidate.enemies)
}

function isGameStatePatch(value: unknown): value is GameStatePatch {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<GameStatePatch>
  return typeof candidate.tick === 'number'
    && typeof candidate.status === 'string'
    && Boolean(candidate.resources)
}

function isGameUiStateUpdate(value: unknown): value is GameUiStateUpdate {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<GameUiStateUpdate>
  return Array.isArray(candidate.buildPalette) || Boolean(candidate.actionBar)
}

function isGameNoticeUpdate(value: unknown): value is GameNoticeUpdate {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<GameNoticeUpdate>
  return Array.isArray(candidate.notices)
}

function mergeGameStatePatch(previousState: GameState | null, patch: GameStatePatch) {
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

function mergeGameUiStateUpdate(previousState: GameState | null, update: GameUiStateUpdate) {
  if (!previousState) {
    return null
  }

  return {
    ...previousState,
    buildPalette: update.buildPalette ?? previousState.buildPalette,
    actionBar: update.actionBar ?? previousState.actionBar,
  }
}

function mergeGameNoticeUpdate(previousState: GameState | null, update: GameNoticeUpdate) {
  if (!previousState) {
    return null
  }

  return {
    ...previousState,
    notices: update.notices,
  }
}

function normalizeTickPayload(payload: unknown, previousState: GameState | null): GameState | null {
  if (isGameState(payload)) {
    return payload
  }

  if (payload && typeof payload === 'object') {
    const candidate = payload as Partial<TickEnvelope> & { state?: unknown, patch?: unknown, gameState?: unknown }

    if (candidate.mode === 'full' && isGameState(candidate.gameState)) {
      return candidate.gameState
    }

    if (candidate.mode === 'patch' && isGameStatePatch(candidate.patch)) {
      return mergeGameStatePatch(previousState, candidate.patch)
    }

    if ('gameState' in candidate && isGameState(candidate.gameState)) {
      return candidate.gameState
    }

    if (isGameStatePatch(candidate.patch)) {
      return mergeGameStatePatch(previousState, candidate.patch)
    }

    if (isGameState(candidate.state)) {
      return candidate.state
    }
  }

  return null
}

function omitReservedIdentityFields(query: Record<string, string | number | boolean | undefined> | undefined) {
  if (!query) {
    return {}
  }

  const {
    playerId: _playerId,
    playerName: _playerName,
    playerKind: _playerKind,
    ...safeQuery
  } = query

  return safeQuery
}

export function useGameEngine(options: UseGameEngineOptions = {}): UseGameEngineResult {
  const socketRef = useRef<Socket | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(options.autoConnect === false ? 'idle' : 'connecting')
  const [error, setError] = useState<string | null>(null)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  const [lastActionAt, setLastActionAt] = useState<number | null>(null)

  const socketUrl = useMemo(() => resolveSocketUrl(), [])
  const gatewayToken = useMemo(() => options.token ?? resolveGatewayToken(), [options.token])
  const connectionQuery = useMemo(() => {
    return {
      ...omitReservedIdentityFields(options.query),
      ...(gatewayToken ? { token: gatewayToken } : {}),
      ...(options.roomId ? { roomId: options.roomId } : {}),
      ...(options.identity?.playerId ? { playerId: options.identity.playerId } : {}),
      ...(options.identity?.playerName ? { playerName: options.identity.playerName } : {}),
      ...(options.identity?.playerKind ? { playerKind: options.identity.playerKind } : {}),
    }
  }, [gatewayToken, options.identity, options.query, options.roomId])

  const handleTickUpdate = useEffectEvent((payload: unknown) => {
    setGameState((currentState) => {
      const nextState = normalizeTickPayload(payload, currentState)
      if (!nextState) {
        return currentState
      }

      return stabilizeGameState(currentState, nextState)
    })
    setLastTickAt(Date.now())
    setConnectionState('connected')
    setError(null)
  })

  const handleUiStateUpdate = useEffectEvent((payload: unknown) => {
    if (!isGameUiStateUpdate(payload)) {
      return
    }

    setGameState((currentState) => mergeGameUiStateUpdate(currentState, payload) ?? currentState)
  })

  const handleNoticeUpdate = useEffectEvent((payload: unknown) => {
    if (!isGameNoticeUpdate(payload)) {
      return
    }

    setGameState((currentState) => mergeGameNoticeUpdate(currentState, payload) ?? currentState)
  })

  useEffect(() => {
    if (typeof window === 'undefined' || options.autoConnect === false || !socketUrl) {
      return
    }

    const socket = io(socketUrl, {
      path: options.path,
      autoConnect: true,
      withCredentials: true,
      auth: gatewayToken ? { token: gatewayToken } : undefined,
      query: connectionQuery,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnectionState('connected')
      setError(null)
    })

    socket.on('disconnect', (reason) => {
      setConnectionState(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting')
    })

    socket.on('connect_error', (connectError) => {
      setConnectionState('error')
      setError(connectError.message)
    })

    socket.on('engine_error', (engineError: { message?: string } | string) => {
      setError(typeof engineError === 'string' ? engineError : engineError.message ?? '游戏引擎返回未知错误')
    })

    socket.on('tick_update', handleTickUpdate)
    socket.on('ui_state_update', handleUiStateUpdate)
    socket.on('notice_update', handleNoticeUpdate)
    socket.io.on('reconnect_attempt', () => {
      setConnectionState('reconnecting')
    })

    return () => {
      socket.off('tick_update', handleTickUpdate)
      socket.off('ui_state_update', handleUiStateUpdate)
      socket.off('notice_update', handleNoticeUpdate)
      socket.disconnect()
      socketRef.current = null
    }
  }, [connectionQuery, gatewayToken, options.autoConnect, options.path, socketUrl])

  const sendAction = useCallback((action: GameAction) => {
    const socket = socketRef.current
    if (!socket || !socket.connected) {
      setError('WebSocket 尚未连接，动作未发送。')
      return false
    }

    socket.emit('send_action', action)
    setLastActionAt(Date.now())
    setError(null)
    return true
  }, [])

  const reconnect = useCallback(() => {
    const socket = socketRef.current
    if (!socket) {
      return
    }

    setConnectionState('connecting')
    socket.connect()
  }, [])

  return {
    socketUrl,
    gameState,
    connectionState,
    error,
    isConnected: connectionState === 'connected',
    lastTickAt,
    lastActionAt,
    sendAction,
    reconnect,
  }
}