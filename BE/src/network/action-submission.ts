import type { ClientAction, PlayerIdentity } from '../domain/actions'
import { parseClientAction } from '../domain/actions'
import { GameEngine } from '../core/game-engine'
import { ActionRateLimiter } from './action-rate-limiter'
import type { Room } from '../core/Room'
import type { PveCheckpointCoordinator } from '../pve-checkpoint-v1'

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
  duplicate: boolean
}

export interface RejectedActionSubmission {
  ok: false
  status: number
  code: 'INVALID_ACTION_PAYLOAD' | 'RATE_LIMITED' | 'REQUEST_ID_CONFLICT' | 'REQUEST_ID_REQUIRED'
  message: string
  retryAfterMs?: number
}

export async function submitDurablePveAction(input: ActionSubmissionInput & {
  room: Room
  checkpointCoordinator: PveCheckpointCoordinator
}): Promise<ActionSubmissionResult> {
  const parsedAction = parseClientAction(normalizeActionPayload(input.payload))
  if (!parsedAction) return { ok: false, status: 400, code: 'INVALID_ACTION_PAYLOAD', message: 'Invalid action payload' }
  const requestId = readRequestId(input.payload)
  if (!requestId) return {
    ok: false, status: 400, code: 'REQUEST_ID_REQUIRED',
    message: 'PVE actions require a stable requestId for durable idempotency',
  }
  const previous = await input.checkpointCoordinator.findAction({
    room: input.room, playerId: input.player.playerId, requestId, action: parsedAction,
  })
  if (previous?.status === 'conflict') return {
    ok: false, status: 409, code: 'REQUEST_ID_CONFLICT', message: 'requestId was already used with a different action payload',
  }
  if (previous?.status === 'duplicate') return {
    ok: true, action: parsedAction, requestId, actionId: previous.record.actionId,
    serverTick: previous.record.serverTick, rateLimitRemaining: previous.record.rateLimitRemaining, duplicate: true,
  }
  const limitDecision = input.limiter.consume(input.player.playerId)
  if (!limitDecision.allowed) return {
    ok: false, status: 429, code: 'RATE_LIMITED', message: 'Action rate limit exceeded', retryAfterMs: limitDecision.retryAfterMs,
  }
  const reserved = await input.checkpointCoordinator.reserveAction({
    room: input.room, player: input.player, requestId, action: parsedAction, rateLimitRemaining: limitDecision.remaining,
  })
  if (reserved.status === 'conflict') return {
    ok: false, status: 409, code: 'REQUEST_ID_CONFLICT', message: 'requestId was already used with a different action payload',
  }
  if (reserved.status === 'duplicate') return {
    ok: true, action: parsedAction, requestId, actionId: reserved.record.actionId,
    serverTick: reserved.record.serverTick, rateLimitRemaining: reserved.record.rateLimitRemaining, duplicate: true,
  }
  input.engine.enqueueDurableAction({
    player: input.player, action: parsedAction, requestId, actionId: reserved.record.actionId,
    rateLimitRemaining: reserved.record.rateLimitRemaining,
  })
  return {
    ok: true, action: parsedAction, requestId, actionId: reserved.record.actionId,
    serverTick: reserved.record.serverTick, rateLimitRemaining: reserved.record.rateLimitRemaining, duplicate: false,
  }
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

  const requestId = readRequestId(payload)
  if (requestId) {
    const previous = engine.resolveActionRequest(player.playerId, requestId, parsedAction)
    if (previous.status === 'conflict') {
      return {
        ok: false,
        status: 409,
        code: 'REQUEST_ID_CONFLICT',
        message: 'requestId was already used with a different action payload',
      }
    }
    if (previous.status === 'replay') {
      return {
        ok: true,
        action: parsedAction,
        requestId,
        actionId: previous.actionId,
        serverTick: previous.serverTick,
        rateLimitRemaining: previous.rateLimitRemaining,
        duplicate: true,
      }
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

  const queued = engine.enqueueAction(player, parsedAction, requestId, limitDecision.remaining)
  return {
    ok: true,
    action: parsedAction,
    requestId,
    actionId: queued.actionId,
    serverTick: queued.serverTick,
    rateLimitRemaining: limitDecision.remaining,
    duplicate: false,
  }
}
