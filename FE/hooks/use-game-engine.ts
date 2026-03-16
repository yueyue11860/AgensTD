import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { resolveGatewayToken, resolveSocketUrl } from '../lib/runtime-config'
import type { ConnectionState, GameAction, GameState, TickEnvelope } from '../types/game-state'

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

function normalizeTickPayload(payload: unknown): GameState | null {
  if (isGameState(payload)) {
    return payload
  }

  if (payload && typeof payload === 'object') {
    const candidate = payload as Partial<TickEnvelope> & { state?: unknown }

    if (isGameState(candidate.gameState)) {
      return candidate.gameState
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
    const nextState = normalizeTickPayload(payload)
    if (!nextState) {
      return
    }

    setGameState(nextState)
    setLastTickAt(Date.now())
    setConnectionState('connected')
    setError(null)
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
    socket.io.on('reconnect_attempt', () => {
      setConnectionState('reconnecting')
    })

    return () => {
      socket.off('tick_update', handleTickUpdate)
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