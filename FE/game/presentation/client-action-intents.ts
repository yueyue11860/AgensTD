export const CLIENT_ACTION_INTENT_TIMEOUT_MS = 3_000
export const CLIENT_ACTION_INTENT_LIMIT = 8

export interface ClientActionIntent {
  requestId: string
  action: string
  label: string
  submittedAt: number
  baselineTick: number
  acceptedAtServerTick: number | null
  target: { x: number, y: number } | null
}

const ACTION_LABELS: Record<string, string> = {
  DEPLOY_TRAY_PIECE: '部署',
  MOVE_BOARD_PIECE: '移动',
  MOVE_FIXED_GENERAL: '迁移神将',
  SWAP_RESERVE_BOARD: '换阵',
  MERGE_SOLDIERS: '合成',
  RECRUIT_BATCH: '召唤',
  USE_ACTIVE_ITEM: '使用道具',
  SET_GENERAL_FIXED: '调整神将',
  SWAP_STORAGE_PIECES: '调整备战',
  EXILE_RESERVE: '遣散',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function targetForAction(payload: Record<string, unknown>): ClientActionIntent['target'] {
  const x = finiteCoordinate(payload.x)
  const y = finiteCoordinate(payload.y)
  if (x !== null && y !== null) return { x, y }

  if (payload.action !== 'USE_ACTIVE_ITEM' || !isRecord(payload.target)) return null
  const xMilli = finiteCoordinate(payload.target.xMilli)
  const yMilli = finiteCoordinate(payload.target.yMilli)
  return xMilli !== null && yMilli !== null
    ? { x: Math.floor(xMilli / 1000), y: Math.floor(yMilli / 1000) }
    : null
}

export function createClientActionIntent(input: {
  requestId: string
  payload: Record<string, unknown>
  submittedAt: number
  baselineTick: number
}): ClientActionIntent {
  const action = typeof input.payload.action === 'string' ? input.payload.action : 'UNKNOWN_ACTION'
  return {
    requestId: input.requestId,
    action,
    label: ACTION_LABELS[action] ?? '执行指令',
    submittedAt: input.submittedAt,
    baselineTick: input.baselineTick,
    acceptedAtServerTick: null,
    target: targetForAction(input.payload),
  }
}

export function appendClientActionIntent(
  intents: readonly ClientActionIntent[],
  intent: ClientActionIntent,
): ClientActionIntent[] {
  return [...intents.filter(candidate => candidate.requestId !== intent.requestId), intent]
    .slice(-CLIENT_ACTION_INTENT_LIMIT)
}

export function acceptClientActionIntent(
  intents: readonly ClientActionIntent[],
  requestId: string,
  serverTick: number,
): ClientActionIntent[] {
  return intents.map(intent => intent.requestId === requestId
    ? { ...intent, acceptedAtServerTick: serverTick }
    : intent)
}

export function rejectClientActionIntent(
  intents: readonly ClientActionIntent[],
  requestId: string | null,
): ClientActionIntent[] {
  return requestId === null ? [] : intents.filter(intent => intent.requestId !== requestId)
}

export function reconcileClientActionIntents(
  intents: readonly ClientActionIntent[],
  authoritativeTick: number,
  now: number,
): ClientActionIntent[] {
  return intents.filter((intent) => {
    if (now - intent.submittedAt >= CLIENT_ACTION_INTENT_TIMEOUT_MS) return false
    if (intent.acceptedAtServerTick === null) return true
    return authoritativeTick <= intent.acceptedAtServerTick
  })
}
