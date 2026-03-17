import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { resolveGatewayToken, resolveSocketUrl } from '../lib/runtime-config'
import type { ConnectionState, GameAction, GameNoticeUpdate, GameState, GameStatePatch, GameUiStateUpdate, TickEnvelope } from '../types/game-state'

// ────────────────────────────── Room 生命周期相关类型 ─────────────────────────────

export type RoomPhase = 'lobby' | 'countdown' | 'waiting_for_level' | 'playing'

export interface SelectedLevelInfo {
  levelId: number
  label: string
  description: string
  waveCount: number
  targetClearRate: number
  minPlayers: number
}

export interface ActionLogEntry {
  /** 操作报文本 */
  action: GameAction
  /** 收到时间戳（ms epoch） */
  ts: number
}

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
  /** 当前房间生命周期，connect 之前为 null */
  roomPhase: RoomPhase | null
  /** 已选择的关卡信息，通过 level_selected 事件更新 */
  selectedLevelInfo: SelectedLevelInfo | null
  /** 当前玩家分配到的房间槽位，'P1' 为房主 */
  mySlot: string | null
  /** 是否为房主（mySlot === 'P1'） */
  isHost: boolean
  sendAction: (action: GameAction) => boolean
  /** 发送任意原始 socket 事件（用于 start_game、select_level 等） */
  sendSocketEvent: (event: string, payload?: unknown) => boolean
  /** 获取本局收集的操作指令快照 */
  getActionSnapshot: () => ActionLogEntry[]
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
  if (!delta || (delta.upsert.length === 0 && delta.remove.length === 0)) {
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
  const committedStateRef = useRef<GameState | null>(null)
  const queuedStateRef = useRef<GameState | null>(null)
  const frameRequestRef = useRef<number | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(options.autoConnect === false ? 'idle' : 'connecting')
  const [error, setError] = useState<string | null>(null)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  const [lastActionAt, setLastActionAt] = useState<number | null>(null)
  const [roomPhase, setRoomPhase] = useState<RoomPhase | null>(null)
  const [selectedLevelInfo, setSelectedLevelInfo] = useState<SelectedLevelInfo | null>(null)
  const [mySlot, setMySlot] = useState<string | null>(null)
  const actionLogRef = useRef<ActionLogEntry[]>([])

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

  const flushQueuedState = useEffectEvent(() => {
    const nextState = queuedStateRef.current
    frameRequestRef.current = null

    if (!nextState) {
      return
    }

    queuedStateRef.current = null
    committedStateRef.current = nextState
    startTransition(() => {
      setGameState(nextState)
    })
  })

  const queueStateUpdate = useEffectEvent((updater: (currentState: GameState | null) => GameState | null) => {
    const baseState = queuedStateRef.current ?? committedStateRef.current
    const nextState = updater(baseState)
    if (!nextState || nextState === baseState) {
      return
    }

    queuedStateRef.current = nextState

    if (typeof window === 'undefined') {
      queuedStateRef.current = null
      committedStateRef.current = nextState
      setGameState(nextState)
      return
    }

    if (frameRequestRef.current !== null) {
      return
    }

    frameRequestRef.current = window.requestAnimationFrame(() => {
      flushQueuedState()
    })
  })

  useEffect(() => {
    committedStateRef.current = gameState
  }, [gameState])

  const handleTickUpdate = useEffectEvent((payload: unknown) => {
    queueStateUpdate((currentState) => {
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

    queueStateUpdate((currentState) => mergeGameUiStateUpdate(currentState, payload) ?? currentState)
  })

  const handleNoticeUpdate = useEffectEvent((payload: unknown) => {
    if (!isGameNoticeUpdate(payload)) {
      return
    }

    queueStateUpdate((currentState) => mergeGameNoticeUpdate(currentState, payload) ?? currentState)
  })

  const handleRoomJoined = useEffectEvent((payload: unknown) => {
    if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).slot === 'string') {
      setMySlot((payload as Record<string, unknown>).slot as string)
    }
  })

  const handleRoomPhaseChanged = useEffectEvent((payload: unknown) => {
    if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).phase === 'string') {
      setRoomPhase((payload as Record<string, unknown>).phase as RoomPhase)
    }
  })

  const handleLevelSelected = useEffectEvent((payload: unknown) => {
    if (
      payload
      && typeof payload === 'object'
      && typeof (payload as Record<string, unknown>).levelId === 'number'
    ) {
      setSelectedLevelInfo(payload as SelectedLevelInfo)
    }
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
    socket.on('room_joined', handleRoomJoined)
    socket.on('room_phase_changed', handleRoomPhaseChanged)
    socket.on('level_selected', handleLevelSelected)
    socket.io.on('reconnect_attempt', () => {
      setConnectionState('reconnecting')
    })

    return () => {
      if (frameRequestRef.current !== null) {
        window.cancelAnimationFrame(frameRequestRef.current)
        frameRequestRef.current = null
      }

      queuedStateRef.current = null
      socket.off('tick_update', handleTickUpdate)
      socket.off('ui_state_update', handleUiStateUpdate)
      socket.off('notice_update', handleNoticeUpdate)
      socket.off('room_joined', handleRoomJoined)
      socket.off('room_phase_changed', handleRoomPhaseChanged)
      socket.off('level_selected', handleLevelSelected)
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
    actionLogRef.current.push({ action, ts: Date.now() })
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

  const sendSocketEvent = useCallback((event: string, payload?: unknown) => {
    const socket = socketRef.current
    if (!socket || !socket.connected) {
      return false
    }

    socket.emit(event, payload)
    return true
  }, [])

  const getActionSnapshot = useCallback(() => {
    return [...actionLogRef.current]
  }, [])

  return {
    socketUrl,
    gameState,
    connectionState,
    error,
    isConnected: connectionState === 'connected',
    lastTickAt,
    lastActionAt,
    roomPhase,
    selectedLevelInfo,
    mySlot,
    isHost: mySlot === 'P1',
    sendAction,
    sendSocketEvent,
    getActionSnapshot,
    reconnect,
  }
}