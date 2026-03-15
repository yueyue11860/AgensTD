import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { ConnectionState, GameAction, GameState, TickEnvelope } from '../types/game-state'

interface RuntimeWindow extends Window {
  __ENV__?: Record<string, string | undefined>
}

interface UseGameEngineOptions {
  autoConnect?: boolean
  path?: string
  roomId?: string
  playerId?: string
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

function resolveSocketUrl() {
  if (typeof window === 'undefined') {
    return null
  }

  const runtimeWindow = window as RuntimeWindow
  const configuredUrl = runtimeWindow.__ENV__?.VITE_WS_URL
    ?? runtimeWindow.__ENV__?.WS_URL
    ?? import.meta.env.VITE_WS_URL

  if (configuredUrl) {
    return configuredUrl
  }

  if (import.meta.env.DEV) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${window.location.hostname}:3000`
  }

  return runtimeWindow.__ENV__?.VITE_WS_URL
    ?? window.location.origin
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

export function useGameEngine(options: UseGameEngineOptions = {}): UseGameEngineResult {
  const socketRef = useRef<Socket | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(options.autoConnect === false ? 'idle' : 'connecting')
  const [error, setError] = useState<string | null>(null)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  const [lastActionAt, setLastActionAt] = useState<number | null>(null)

  const socketUrl = useMemo(() => resolveSocketUrl(), [])
  const connectionQuery = useMemo(() => {
    return {
      ...options.query,
      ...(options.roomId ? { roomId: options.roomId } : {}),
      ...(options.playerId ? { playerId: options.playerId } : {}),
    }
  }, [options.playerId, options.query, options.roomId])

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
  }, [connectionQuery, options.autoConnect, options.path, socketUrl])

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