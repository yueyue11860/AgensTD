export type ConnectionRecoveryPhase =
  | 'ready'
  | 'reconnecting'
  | 'awaiting_snapshot'
  | 'expired'
  | 'replaced'
  | 'auth_failed'

export interface ConnectionRecoveryState {
  phase: ConnectionRecoveryPhase
  deadlineAt: number | null
  graceMs: number
  syncRevision: number
  message: string | null
}

export type ConnectionRecoveryEvent =
  | { type: 'transport_disconnected', now: number }
  | { type: 'transport_connected' }
  | { type: 'server_reconnecting', deadlineAt: number, graceMs?: number }
  | { type: 'full_snapshot' }
  | { type: 'deadline_tick', now: number }
  | { type: 'replaced' }
  | { type: 'auth_failed', message?: string }
  | { type: 'retry', now: number }

export interface PlayerConnectionStatePayload {
  playerId: string
  status: 'connected' | 'reconnecting' | 'disconnected'
  reconnectDeadlineAt: number | null
  reconnectRemainingMs: number
  graceMs: number
}

export const DEFAULT_RECONNECT_GRACE_MS = 45_000

export function createConnectionRecoveryState(graceMs = DEFAULT_RECONNECT_GRACE_MS): ConnectionRecoveryState {
  return { phase: 'awaiting_snapshot', deadlineAt: null, graceMs, syncRevision: 0, message: null }
}

export function reduceConnectionRecovery(
  state: ConnectionRecoveryState,
  event: ConnectionRecoveryEvent,
): ConnectionRecoveryState {
  switch (event.type) {
    case 'transport_disconnected':
      return {
        ...state,
        phase: 'reconnecting',
        deadlineAt: state.deadlineAt ?? event.now + state.graceMs,
        message: '网络连接中断，正在保留席位并重连。',
      }
    case 'transport_connected':
      return { ...state, phase: 'awaiting_snapshot', message: '连接已恢复，正在校准权威战局。' }
    case 'server_reconnecting':
      return {
        ...state,
        phase: 'reconnecting',
        deadlineAt: event.deadlineAt,
        graceMs: event.graceMs ?? state.graceMs,
        message: '服务器正在为你保留席位。',
      }
    case 'full_snapshot':
      return { ...state, phase: 'ready', deadlineAt: null, syncRevision: state.syncRevision + 1, message: null }
    case 'deadline_tick':
      if (state.deadlineAt === null || event.now < state.deadlineAt || state.phase === 'ready') return state
      return { ...state, phase: 'expired', message: '重连期限已过，本局席位已释放。' }
    case 'replaced':
      return { ...state, phase: 'replaced', deadlineAt: null, message: '此账号已在另一个窗口接管本局。' }
    case 'auth_failed':
      return { ...state, phase: 'auth_failed', deadlineAt: null, message: event.message ?? '登录凭证已失效，请重新登录。' }
    case 'retry':
      return { ...state, phase: 'reconnecting', deadlineAt: event.now + state.graceMs, message: '正在重新连接服务器。' }
  }
}

export function reconnectRemainingSeconds(deadlineAt: number | null, now = Date.now()): number | null {
  return deadlineAt === null ? null : Math.max(0, Math.ceil((deadlineAt - now) / 1000))
}

export function isAuthoritativeFullTick(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as { mode?: unknown, gameState?: unknown, state?: unknown, tick?: unknown }
  if (candidate.mode === 'full' && candidate.gameState && typeof candidate.gameState === 'object') return true
  if (typeof candidate.tick === 'number') return true
  return Boolean(candidate.state && typeof candidate.state === 'object' && typeof (candidate.state as { tick?: unknown }).tick === 'number')
}

export function parsePlayerConnectionState(payload: unknown): PlayerConnectionStatePayload | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<PlayerConnectionStatePayload>
  if (
    typeof candidate.playerId !== 'string'
    || (candidate.status !== 'connected' && candidate.status !== 'reconnecting' && candidate.status !== 'disconnected')
  ) return null
  return {
    playerId: candidate.playerId,
    status: candidate.status,
    reconnectDeadlineAt: typeof candidate.reconnectDeadlineAt === 'number' ? candidate.reconnectDeadlineAt : null,
    reconnectRemainingMs: typeof candidate.reconnectRemainingMs === 'number' ? Math.max(0, candidate.reconnectRemainingMs) : 0,
    graceMs: typeof candidate.graceMs === 'number' ? Math.max(0, candidate.graceMs) : DEFAULT_RECONNECT_GRACE_MS,
  }
}

export function isAuthenticationFailure(message: string): boolean {
  return /missing or invalid gateway token|authentication|unauthori[sz]ed|登录|凭证/i.test(message)
}
