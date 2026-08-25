import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { resolveGatewayToken, resolveSocketUrl } from '../lib/runtime-config'
import type { ConnectionState, GameAction, GameNoticeUpdate, GameState, GameStatePatch, GameUiStateUpdate, TickEnvelope } from '../types/game-state'
import type { RoomSummary } from './use-room-lobby-data'
import {
  createConnectionRecoveryState,
  isAuthenticationFailure,
  isAuthoritativeFullTick,
  parsePlayerConnectionState,
  reduceConnectionRecovery,
  type ConnectionRecoveryPhase,
} from '../game/network/connection-recovery'
import { useDeadlineCountdown } from './use-deadline-countdown'
import { applyPveDeltaToGameState } from '../../shared/contracts/pve-state-delta'
import {
  baselineCombatEventStream,
  CLIENT_COMBAT_PRESENTATION_VERSION,
  classifyStateEnvelope,
  createCombatEventStreamState,
  isCombatEventBatch,
  mergeCombatEventBatch,
  mergeCombatEventsIntoGameState,
} from '../game/network/combat-event-stream'

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
  isAuthoritativeStateReady: boolean
  recoveryPhase: ConnectionRecoveryPhase
  reconnectDeadlineAt: number | null
  reconnectRemainingSeconds: number | null
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

  if (patch.tick <= previousState.tick) {
    return previousState
  }

  return {
    ...previousState,
    ...patch,
    towers: patch.towers ?? applyEntityDelta(previousState.towers, patch.towerDelta),
    enemies: patch.enemies ?? applyEntityDelta(previousState.enemies, patch.enemyDelta),
    map: patch.map ?? previousState.map,
    pve: applyPveDeltaToGameState(previousState, patch),
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

    if ((candidate.mode === 'patch' || candidate.mode === 'checkpoint') && isGameStatePatch(candidate.patch)) {
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
  const [recovery, setRecovery] = useState(() => createConnectionRecoveryState())
  const awaitingCheckpointRef = useRef(Boolean(options.roomId))
  const connectionGraceMsRef = useRef(45_000)
  const stateRevisionRef = useRef(0)
  const combatEventStreamRef = useRef(createCombatEventStreamState())
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
  const reconnectRemainingSeconds = useDeadlineCountdown(recovery.deadlineAt)

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
    awaitingCheckpointRef.current = Boolean(options.roomId)
    stateRevisionRef.current = 0
    combatEventStreamRef.current = createCombatEventStreamState()
    setRecovery(createConnectionRecoveryState())
  }, [options.roomId])

  useEffect(() => {
    if (reconnectRemainingSeconds !== 0 || recovery.deadlineAt === null || recovery.phase === 'ready') return
    setRecovery((current) => reduceConnectionRecovery(current, { type: 'deadline_tick', now: Date.now() }))
  }, [reconnectRemainingSeconds, recovery.deadlineAt, recovery.phase])

  useEffect(() => {
    if (recovery.phase !== 'expired') return
    setConnectionState('disconnected')
    setError('重连期限已过。可返回房间重新加入，或手动重试连接。')
  }, [recovery.phase])

  useEffect(() => {
    committedStateRef.current = gameState
  }, [gameState])

  const handleTickUpdate = useEffectEvent((payload: unknown) => {
    const envelope = payload && typeof payload === 'object'
      && ((payload as { mode?: unknown }).mode === 'full'
        || (payload as { mode?: unknown }).mode === 'patch'
        || (payload as { mode?: unknown }).mode === 'checkpoint')
      ? payload as TickEnvelope
      : null
    if (envelope) {
      const decision = classifyStateEnvelope(envelope, stateRevisionRef.current)
      if (decision === 'stale') return
      if (decision === 'gap') {
        awaitingCheckpointRef.current = true
        socketRef.current?.emit('REQUEST_FULL_STATE')
        return
      }
    }
    const isFull = isAuthoritativeFullTick(payload)
    if (awaitingCheckpointRef.current && !isFull) {
      socketRef.current?.emit('REQUEST_FULL_STATE')
      return
    }
    if (isFull) {
      const baseState = queuedStateRef.current ?? committedStateRef.current
      const normalized = normalizeTickPayload(payload, baseState)
      if (!normalized) return
      if (frameRequestRef.current !== null) {
        window.cancelAnimationFrame(frameRequestRef.current)
        frameRequestRef.current = null
      }
      queuedStateRef.current = null
      const nextState = stabilizeGameState(baseState, normalized)
      if (envelope?.mode === 'full') {
        stateRevisionRef.current = envelope.revision ?? nextState.tick
        if (envelope.presentationVersion === CLIENT_COMBAT_PRESENTATION_VERSION) {
          combatEventStreamRef.current = baselineCombatEventStream(nextState.matchId, envelope.eventSeq)
        }
        else {
          combatEventStreamRef.current = createCombatEventStreamState()
        }
      }
      else {
        stateRevisionRef.current = nextState.tick
      }
      committedStateRef.current = nextState
      setGameState(nextState)
      awaitingCheckpointRef.current = false
      setRecovery((current) => reduceConnectionRecovery(current, { type: 'full_snapshot' }))
      setConnectionState('connected')
      setLastTickAt(Date.now())
      setError(null)
      return
    }
    queueStateUpdate((currentState) => {
      const nextState = normalizeTickPayload(payload, currentState)
      if (!nextState) {
        if (
          payload
          && typeof payload === 'object'
          && ((payload as { mode?: unknown }).mode === 'patch' || (payload as { mode?: unknown }).mode === 'checkpoint')
        ) {
          socketRef.current?.emit('REQUEST_FULL_STATE')
        }
        return currentState
      }

      return stabilizeGameState(currentState, nextState)
    })
    if (envelope?.revision !== undefined) stateRevisionRef.current = envelope.revision
    setLastTickAt(Date.now())
    setError(null)
  })

  const handleCombatEventBatch = useEffectEvent((payload: unknown) => {
    if (!isCombatEventBatch(payload)) return
    const result = mergeCombatEventBatch(combatEventStreamRef.current, payload)
    combatEventStreamRef.current = result.state
    if (result.accepted.length > 0) {
      queueStateUpdate((currentState) => mergeCombatEventsIntoGameState(currentState, result.accepted))
    }
    if (result.ackSeq !== null) {
      socketRef.current?.emit('COMBAT_EVENT_ACK', {
        matchId: payload.matchId,
        presentationVersion: CLIENT_COMBAT_PRESENTATION_VERSION,
        ackSeq: result.ackSeq,
      })
    }
    if (result.gapFromSeq !== null) {
      socketRef.current?.emit('REQUEST_COMBAT_EVENTS', {
        matchId: payload.matchId,
        presentationVersion: CLIENT_COMBAT_PRESENTATION_VERSION,
        fromSeq: result.gapFromSeq,
      })
    }
  })

  const handleCombatEventReset = useEffectEvent(() => {
    awaitingCheckpointRef.current = true
    socketRef.current?.emit('REQUEST_FULL_STATE')
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

  const handlePlayerConnectionState = useEffectEvent((payload: unknown) => {
    const update = parsePlayerConnectionState(payload)
    if (!update) return
    if (update.playerId === identityPlayerId) connectionGraceMsRef.current = update.graceMs
    setRoomSummary((current) => current
      ? {
          ...current,
          slots: current.slots.map((slot) => slot.playerId === update.playerId
            ? {
                ...slot,
                connected: update.status === 'connected',
                connectionState: update.status,
                reconnectDeadlineAt: update.reconnectDeadlineAt ?? undefined,
                reconnectRemainingMs: update.reconnectRemainingMs,
              }
            : slot),
        }
      : current)
    if (update.playerId === identityPlayerId && update.status === 'reconnecting' && update.reconnectDeadlineAt !== null) {
      const deadlineAt = update.reconnectDeadlineAt
      setRecovery((current) => reduceConnectionRecovery(current, {
        type: 'server_reconnecting', deadlineAt, graceMs: update.graceMs,
      }))
    }
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
      awaitingCheckpointRef.current = Boolean(options.roomId)
      if (options.roomId) {
        setConnectionState('synchronizing')
        setRecovery((current) => reduceConnectionRecovery(current, { type: 'transport_connected' }))
      }
      else {
        setConnectionState('connected')
        setRecovery((current) => ({ ...current, phase: 'ready', deadlineAt: null, message: null }))
      }
      setError(null)

      if (options.roomId) {
        socket.emit('JOIN_ROOM', {
          roomId: options.roomId,
          playerId: identityPlayerId,
          playerName: identityPlayerName,
          playerKind: identityPlayerKind,
          capabilities: { combatEventBatch: CLIENT_COMBAT_PRESENTATION_VERSION },
        })
      }
    }

    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      awaitingCheckpointRef.current = Boolean(options.roomId)
      setConnectionState(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting')
      if (reason !== 'io client disconnect') {
        const deadlineAt = Date.now() + connectionGraceMsRef.current
        setRecovery((current) => reduceConnectionRecovery(current, {
          type: 'server_reconnecting', deadlineAt, graceMs: connectionGraceMsRef.current,
        }))
        setRoomSummary((current) => current
          ? {
              ...current,
              slots: current.slots.map((slot) => slot.playerId === identityPlayerId
                ? { ...slot, connected: false, connectionState: 'reconnecting', reconnectDeadlineAt: deadlineAt, reconnectRemainingMs: connectionGraceMsRef.current }
                : slot),
            }
          : current)
      }
    }

    const handleConnectError = (connectError: Error) => {
      if (isAuthenticationFailure(connectError.message)) {
        socket.io.opts.reconnection = false
        setRecovery((current) => reduceConnectionRecovery(current, { type: 'auth_failed', message: '登录凭证已失效，请重新登录后进入房间。' }))
        setConnectionState('error')
        setError('登录凭证已失效，请重新登录后进入房间。')
        return
      }
      setConnectionState('reconnecting')
      setError(`暂时无法连接服务器：${connectError.message}`)
    }

    const handleEngineError = (engineError: { code?: string, message?: string } | string) => {
      const message = typeof engineError === 'string' ? engineError : engineError.message ?? '游戏引擎返回未知错误'
      if (typeof engineError !== 'string' && engineError.code === 'RECONNECT_WINDOW_EXPIRED') {
        setRecovery((current) => ({ ...current, phase: 'expired', deadlineAt: null, message }))
        setConnectionState('disconnected')
      }
      setError(message)
    }

    const handleReconnectAttempt = () => {
      setConnectionState('reconnecting')
    }
    const handleReconnectFailed = () => {
      setConnectionState('error')
      setError('自动重连未成功。请手动重试，或返回房间重新加入。')
    }
    const handleConnectionReplaced = () => {
      socket.io.opts.reconnection = false
      awaitingCheckpointRef.current = true
      setRecovery((current) => reduceConnectionRecovery(current, { type: 'replaced' }))
      setConnectionState('disconnected')
      setError('此账号已在另一个窗口接管本局；如非本人操作，请重新登录。')
      socket.disconnect()
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('engine_error', handleEngineError)

    socket.on('TICK_UPDATE', handleTickUpdate)
    socket.on('COMBAT_EVENT_BATCH', handleCombatEventBatch)
    socket.on('COMBAT_EVENT_RESET', handleCombatEventReset)
    socket.on('UI_STATE_UPDATE', handleUiStateUpdate)
    socket.on('NOTICE_UPDATE', handleNoticeUpdate)
    socket.on('ROOM_JOINED', handleRoomJoined)
    socket.on('ROOM_SNAPSHOT', handleRoomSnapshot)
    socket.on('PLAYER_CONNECTION_STATE', handlePlayerConnectionState)
    socket.on('PLAYER_CONNECTION_REPLACED', handleConnectionReplaced)
    socket.on('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
    socket.on('START_MATCH_ACCEPTED', handleStartMatchAccepted)
    socket.on('COUNTDOWN_TICK', handleCountdownTick)
    socket.on('LEVEL_SELECTED', handleLevelSelected)
    socket.io.on('reconnect_attempt', handleReconnectAttempt)
    socket.io.on('reconnect_failed', handleReconnectFailed)

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
      socket.off('COMBAT_EVENT_BATCH', handleCombatEventBatch)
      socket.off('COMBAT_EVENT_RESET', handleCombatEventReset)
      socket.off('UI_STATE_UPDATE', handleUiStateUpdate)
      socket.off('NOTICE_UPDATE', handleNoticeUpdate)
      socket.off('ROOM_JOINED', handleRoomJoined)
      socket.off('ROOM_SNAPSHOT', handleRoomSnapshot)
      socket.off('PLAYER_CONNECTION_STATE', handlePlayerConnectionState)
      socket.off('PLAYER_CONNECTION_REPLACED', handleConnectionReplaced)
      socket.off('ROOM_PHASE_CHANGED', handleRoomPhaseChanged)
      socket.off('START_MATCH_ACCEPTED', handleStartMatchAccepted)
      socket.off('COUNTDOWN_TICK', handleCountdownTick)
      socket.off('LEVEL_SELECTED', handleLevelSelected)
      socket.io.off('reconnect_attempt', handleReconnectAttempt)
      socket.io.off('reconnect_failed', handleReconnectFailed)
      socket.disconnect()
      socketRef.current = null
    }
  }, [connectionQuery, gatewayToken, identityPlayerId, identityPlayerKind, identityPlayerName, options.autoConnect, options.path, options.roomId, socketUrl])

  const sendAction = useCallback((action: GameAction) => {
    const socket = socketRef.current
    if (!socket || !socket.connected || awaitingCheckpointRef.current) {
      setError('权威战局尚未恢复，操作已锁定且不会发送。')
      return false
    }

    socket.emit('SEND_ACTION', {
      requestId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      clientTick: committedStateRef.current?.tick,
      payload: action,
    })
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
    socket.io.opts.reconnection = true
    awaitingCheckpointRef.current = Boolean(options.roomId)
    setRecovery((current) => reduceConnectionRecovery(current, { type: 'retry', now: Date.now() }))
    socket.connect()
  }, [options.roomId])

  const sendSocketEvent = useCallback((event: string, payload?: unknown) => {
    const socket = socketRef.current
    if (!socket || !socket.connected || awaitingCheckpointRef.current) {
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
    isConnected: connectionState === 'connected' && recovery.phase === 'ready',
    isAuthoritativeStateReady: recovery.phase === 'ready',
    recoveryPhase: recovery.phase,
    reconnectDeadlineAt: recovery.deadlineAt,
    reconnectRemainingSeconds,
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
