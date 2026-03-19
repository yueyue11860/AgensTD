import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { resolveGatewayToken, resolveSocketUrl } from '../lib/runtime-config'
import type { ConnectionState, GameAction, GameNoticeUpdate, GameState, GameStatePatch, GameUiStateUpdate, TickEnvelope } from '../types/game-state'
import type { RoomSummary } from './use-room-lobby-data'

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

interface CountdownPayload {
  remainingSeconds: number
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
  roomSummary: RoomSummary | null
  connectionState: ConnectionState
  error: string | null
  isConnected: boolean
  lastTickAt: number | null
  lastActionAt: number | null
  /** 当前房间生命周期，connect 之前为 null */
  roomPhase: RoomPhase | null
  countdownSeconds: number | null
  /** 已选择的关卡信息，通过 LEVEL_SELECTED 事件更新 */
  selectedLevelInfo: SelectedLevelInfo | null
  /** 当前玩家分配到的房间槽位，'P1' 为房主 */
  mySlot: string | null
  /** 是否为房主（mySlot === 'P1'） */
  isHost: boolean
  sendAction: (action: GameAction) => boolean
  /** 发送任意原始 socket 事件（用于 START_MATCH、SELECT_LEVEL 等） */
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

function isRoomSummary(value: unknown): value is RoomSummary {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RoomSummary>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.players === 'number'
    && typeof candidate.maxPlayers === 'number'
    && Array.isArray(candidate.slots)
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
  const [roomSummary, setRoomSummary] = useState<RoomSummary | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(options.autoConnect === false ? 'idle' : 'connecting')
  const [error, setError] = useState<string | null>(null)
  const [lastTickAt, setLastTickAt] = useState<number | null>(null)
  const [lastActionAt, setLastActionAt] = useState<number | null>(null)
  const [roomPhase, setRoomPhase] = useState<RoomPhase | null>(null)
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null)
  const [selectedLevelInfo, setSelectedLevelInfo] = useState<SelectedLevelInfo | null>(null)
  const [mySlot, setMySlot] = useState<string | null>(null)
  const actionLogRef = useRef<ActionLogEntry[]>([])
  const identityPlayerId = options.identity?.playerId
  const identityPlayerName = options.identity?.playerName
  const identityPlayerKind = options.identity?.playerKind

  const socketUrl = useMemo(() => resolveSocketUrl(), [])
  const gatewayToken = useMemo(() => options.token ?? resolveGatewayToken(), [options.token])
  const querySignature = useMemo(() => {
    const entries = Object.entries(omitReservedIdentityFields(options.query))
      .filter(([, value]) => value !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

    return JSON.stringify(entries)
  }, [options.query])
  const connectionQuery = useMemo(() => {
    const safeQueryEntries = JSON.parse(querySignature) as Array<[string, string | number | boolean]>

    return {
      ...Object.fromEntries(safeQueryEntries),
      ...(gatewayToken ? { token: gatewayToken } : {}),
      ...(options.roomId ? { roomId: options.roomId } : {}),
      ...(identityPlayerId ? { playerId: identityPlayerId } : {}),
      ...(identityPlayerName ? { playerName: identityPlayerName } : {}),
      ...(identityPlayerKind ? { playerKind: identityPlayerKind } : {}),
    }
  }, [gatewayToken, identityPlayerId, identityPlayerKind, identityPlayerName, options.roomId, querySignature])

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
    setRoomPhase(null)
    setCountdownSeconds(null)
    setSelectedLevelInfo(null)
    setMySlot(null)
    setRoomSummary(null)
  }, [options.roomId])

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

  const handleRoomSnapshot = useEffectEvent((payload: unknown) => {
    if (!isRoomSummary(payload)) {
      return
    }

    setRoomSummary(payload)
  })

  const handleRoomPhaseChanged = useEffectEvent((payload: unknown) => {
    if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).phase === 'string') {
      const phase = (payload as Record<string, unknown>).phase as RoomPhase
      setRoomPhase(phase)

      if (phase !== 'countdown') {
        setCountdownSeconds(null)
      }
    }
  })

  const handleStartMatchAccepted = useEffectEvent((payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const candidate = payload as Partial<CountdownPayload> & { phase?: unknown }
    if (candidate.phase === 'countdown' && typeof candidate.remainingSeconds === 'number') {
      setRoomPhase('countdown')
      setCountdownSeconds(candidate.remainingSeconds)
    }
  })

  const handleCountdownTick = useEffectEvent((payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const candidate = payload as Partial<CountdownPayload>
    if (typeof candidate.remainingSeconds === 'number') {
      setCountdownSeconds(candidate.remainingSeconds)
    }
  })

  const handleLevelSelected = useEffectEvent((payload: unknown) => {
    if (
      payload
      && typeof payload === 'object'
      && typeof (payload as Record<string, unknown>).levelId === 'number'
      && typeof (payload as Record<string, unknown>).label === 'string'
      && typeof (payload as Record<string, unknown>).description === 'string'
      && typeof (payload as Record<string, unknown>).waveCount === 'number'
      && typeof (payload as Record<string, unknown>).targetClearRate === 'number'
      && typeof (payload as Record<string, unknown>).minPlayers === 'number'
    ) {
      const candidate = payload as Record<string, unknown>
      setSelectedLevelInfo({
        levelId: candidate.levelId as number,
        label: candidate.label as string,
        description: candidate.description as string,
        waveCount: candidate.waveCount as number,
        targetClearRate: candidate.targetClearRate as number,
        minPlayers: candidate.minPlayers as number,
      })
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
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.5,
      timeout: 8000,
      auth: gatewayToken ? { token: gatewayToken } : undefined,
      query: connectionQuery,
    })

    socketRef.current = socket

    const handleConnect = () => {
      setConnectionState('connected')
      setError(null)

      if (options.roomId) {
        socket.emit('JOIN_ROOM', {
          roomId: options.roomId,
          playerId: identityPlayerId,
          playerName: identityPlayerName,
          playerKind: identityPlayerKind,
        })
      }
    }

    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      setConnectionState(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting')
    }

    const handleConnectError = (connectError: Error) => {
      setConnectionState('error')
      setError(connectError.message)
    }

    const handleEngineError = (engineError: { message?: string } | string) => {
      setError(typeof engineError === 'string' ? engineError : engineError.message ?? '游戏引擎返回未知错误')
    }

    const handleReconnectAttempt = () => {
      setConnectionState('reconnecting')
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('engine_error', handleEngineError)

    socket.on('TICK_UPDATE', handleTickUpdate)
    socket.on('UI_STATE_UPDATE', handleUiStateUpdate)
    socket.on('NOTICE_UPDATE', handleNoticeUpdate)
    socket.on('ROOM_JOINED', handleRoomJoined)
    socket.on('ROOM_SNAPSHOT', handleRoomSnapshot)
    socket.on('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
    socket.on('START_MATCH_ACCEPTED', handleStartMatchAccepted)
    socket.on('COUNTDOWN_TICK', handleCountdownTick)
    socket.on('LEVEL_SELECTED', handleLevelSelected)
    socket.io.on('reconnect_attempt', handleReconnectAttempt)

    return () => {
      if (frameRequestRef.current !== null) {
        window.cancelAnimationFrame(frameRequestRef.current)
        frameRequestRef.current = null
      }

      queuedStateRef.current = null
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      socket.off('engine_error', handleEngineError)
      socket.off('TICK_UPDATE', handleTickUpdate)
      socket.off('UI_STATE_UPDATE', handleUiStateUpdate)
      socket.off('NOTICE_UPDATE', handleNoticeUpdate)
      socket.off('ROOM_JOINED', handleRoomJoined)
      socket.off('ROOM_SNAPSHOT', handleRoomSnapshot)
      socket.off('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
      socket.off('START_MATCH_ACCEPTED', handleStartMatchAccepted)
      socket.off('COUNTDOWN_TICK', handleCountdownTick)
      socket.off('LEVEL_SELECTED', handleLevelSelected)
      socket.io.off('reconnect_attempt', handleReconnectAttempt)
      socket.disconnect()
      socketRef.current = null
    }
  }, [connectionQuery, gatewayToken, identityPlayerId, identityPlayerKind, identityPlayerName, options.autoConnect, options.path, options.roomId, socketUrl])

  const sendAction = useCallback((action: GameAction) => {
    const socket = socketRef.current
    if (!socket || !socket.connected) {
      setError('WebSocket 尚未连接，动作未发送。')
      return false
    }

    socket.emit('SEND_ACTION', action)
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
    roomSummary,
    connectionState,
    error,
    isConnected: connectionState === 'connected',
    lastTickAt,
    lastActionAt,
    roomPhase,
    countdownSeconds,
    selectedLevelInfo,
    mySlot,
    isHost: mySlot === 'P1',
    sendAction,
    sendSocketEvent,
    getActionSnapshot,
    reconnect,
  }
}