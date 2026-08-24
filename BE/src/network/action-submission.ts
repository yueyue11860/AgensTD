import type { ClientAction, PlayerIdentity } from '../domain/actions'
import { parseClientAction } from '../domain/actions'
import { GameEngine } from '../core/game-engine'
import { ActionRateLimiter } from './action-rate-limiter'

interface ActionSubmissionInput {
  engine: GameEngine
  limiter: ActionRateLimiter
  player: PlayerIdentity
  payload: unknown
}

export interface AcceptedActionSubmission {
  ok: true
  action: ClientAction
  requestId: string | null
  actionId: string
  serverTick: number
  rateLimitRemaining: number
}

export interface RejectedActionSubmission {
  ok: false
  status: number
  code: 'INVALID_ACTION_PAYLOAD' | 'RATE_LIMITED'
  message: string
  retryAfterMs?: number
}

export type ActionSubmissionResult = AcceptedActionSubmission | RejectedActionSubmission

function normalizeActionPayload(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload
  }

  if ('payload' in payload) {
    return (payload as { payload?: unknown }).payload
  }

  return payload
}

function readRequestId(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null
  }

  const requestId = (payload as { requestId?: unknown }).requestId
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : null
}

export function submitAction({ engine, limiter, player, payload }: ActionSubmissionInput): ActionSubmissionResult {
  const parsedAction = parseClientAction(normalizeActionPayload(payload))
  if (!parsedAction) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_ACTION_PAYLOAD',
      message: 'Invalid action payload',
    }
  }

  const limitDecision = limiter.consume(player.playerId)
  if (!limitDecision.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Action rate limit exceeded',
      retryAfterMs: limitDecision.retryAfterMs,
    }
  }

  const queued = engine.enqueueAction(player, parsedAction)
  return {
    ok: true,
    action: parsedAction,
    requestId: readRequestId(payload),
    actionId: queued.actionId,
    serverTick: queued.serverTick,
    rateLimitRemaining: limitDecision.remaining,
  }
}
