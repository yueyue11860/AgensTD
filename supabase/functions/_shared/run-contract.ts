const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'HELL'] as const
const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'timeout'] as const
const RUN_EVENT_TYPES = ['queued', 'started', 'tick', 'milestone', 'completed', 'failed', 'timeout'] as const
const GAME_PHASES = ['PREP', 'COMBAT', 'RESOLUTION', 'DECISION'] as const
const ACTION_TYPES = ['BUILD', 'UPGRADE', 'SELL', 'MODULATE', 'RETARGET', 'CAST', 'CONSUME', 'REPAIR', 'REROUTE', 'BUY', 'REFRESH_SHOP', 'CHOOSE_OPTION', 'PAUSE_OR_RESUME', 'NO_OP'] as const
const ACTION_TARGET_KINDS = ['cell', 'tower', 'enemy', 'route', 'shop', 'option', 'global'] as const

type Difficulty = (typeof DIFFICULTIES)[number]
type RunStatus = (typeof RUN_STATUSES)[number]
type RunEventType = (typeof RUN_EVENT_TYPES)[number]
type GamePhase = (typeof GAME_PHASES)[number]
type ActionType = (typeof ACTION_TYPES)[number]
type ActionTargetKind = (typeof ACTION_TARGET_KINDS)[number]

type JsonRecord = Record<string, unknown>

export interface RunnerResources {
  gold: number
  heat: number
  heat_limit: number
  mana: number
  mana_limit: number
  repair: number
  threat: number
  fortress: number
  fortress_max: number
}

export interface RunnerResultSummary extends JsonRecord {
  resources?: RunnerResources
  actionWindow?: JsonRecord
}

export interface RunnerEventBatchEntry {
  eventType: RunEventType
  tick?: number
  payload: JsonRecord
}

export interface RunnerReplaySnapshot {
  tick?: number
  timestamp: string
  game_state: {
    resources: RunnerResources
    towers: unknown[]
    enemies: unknown[]
    wave: number
    score: number
    phase: GamePhase
    observation_version: number
  }
}

export interface RunnerEnqueuePayload {
  agentId: string
  difficulty: Difficulty
  seed?: number
  maxTicks?: number
  seasonCode?: string | null
}

export interface RunnerProgressPayload {
  runId: string
  status: RunStatus
  startTime?: string
  endTime?: string
  durationMs?: number
  currentTick?: number
  maxTicks?: number
  score?: number
  wave?: number
  maxWave?: number
  resources?: RunnerResources
  towersBuilt?: number
  enemiesKilled?: number
  damageDealt?: number
  damageTaken?: number
  isLive?: boolean
  errorMessage?: string
  resultSummary?: RunnerResultSummary
  eventType?: RunEventType
  eventPayload?: JsonRecord
  eventBatch?: RunnerEventBatchEntry[]
  snapshot?: RunnerReplaySnapshot
}

export interface RunnerActionIntent {
  actionType: ActionType
  targetKind: ActionTargetKind
  targetId?: string
  targetCell?: { x: number; y: number }
  payload?: JsonRecord
}

export interface RunnerSubmitActionPayload {
  runId: string
  action: RunnerActionIntent
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && DIFFICULTIES.includes(value as Difficulty)
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && RUN_STATUSES.includes(value as RunStatus)
}

function isRunEventType(value: unknown): value is RunEventType {
  return typeof value === 'string' && RUN_EVENT_TYPES.includes(value as RunEventType)
}

function isGamePhase(value: unknown): value is GamePhase {
  return typeof value === 'string' && GAME_PHASES.includes(value as GamePhase)
}

function isActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && ACTION_TYPES.includes(value as ActionType)
}

function isActionTargetKind(value: unknown): value is ActionTargetKind {
  return typeof value === 'string' && ACTION_TARGET_KINDS.includes(value as ActionTargetKind)
}

function assertOptionalNumber(value: unknown, fieldName: string) {
  if (value !== undefined && !isFiniteNumber(value)) {
    throw new Error(`Invalid ${fieldName}`)
  }
}

function assertOptionalString(value: unknown, fieldName: string) {
  if (value !== undefined && value !== null && !isString(value)) {
    throw new Error(`Invalid ${fieldName}`)
  }
}

function assertOptionalBoolean(value: unknown, fieldName: string) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`Invalid ${fieldName}`)
  }
}

function isResources(value: unknown): value is RunnerResources {
  if (!isRecord(value)) {
    return false
  }

  return [
    value.gold,
    value.heat,
    value.heat_limit,
    value.mana,
    value.mana_limit,
    value.repair,
    value.threat,
    value.fortress,
    value.fortress_max,
  ].every(isFiniteNumber)
}

function isResultSummary(value: unknown): value is RunnerResultSummary {
  if (!isRecord(value)) {
    return false
  }

  if (value.resources !== undefined && !isResources(value.resources)) {
    return false
  }

  if (value.actionWindow !== undefined && !isRecord(value.actionWindow)) {
    return false
  }

  return true
}

function isReplaySnapshot(value: unknown): value is RunnerReplaySnapshot {
  if (!isRecord(value) || !isString(value.timestamp) || !isRecord(value.game_state)) {
    return false
  }

  const gameState = value.game_state

  return (
    isResources(gameState.resources)
    && Array.isArray(gameState.towers)
    && Array.isArray(gameState.enemies)
    && isFiniteNumber(gameState.wave)
    && isFiniteNumber(gameState.score)
    && isGamePhase(gameState.phase)
    && isFiniteNumber(gameState.observation_version)
  )
}

function isEventBatchEntry(value: unknown): value is RunnerEventBatchEntry {
  if (!isRecord(value) || !isRunEventType(value.eventType) || !isRecord(value.payload)) {
    return false
  }

  return value.tick === undefined || isFiniteNumber(value.tick)
}

function isGridPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isRunnerActionIntent(value: unknown): value is RunnerActionIntent {
  if (!isRecord(value) || !isActionType(value.actionType) || !isActionTargetKind(value.targetKind)) {
    return false
  }

  if (value.targetId !== undefined && !isString(value.targetId)) {
    return false
  }

  if (value.targetCell !== undefined && !isGridPoint(value.targetCell)) {
    return false
  }

  if (value.payload !== undefined && !isRecord(value.payload)) {
    return false
  }

  return true
}

export function parseEnqueuePayload(value: unknown): RunnerEnqueuePayload {
  if (!isRecord(value)) {
    throw new Error('Invalid enqueue payload')
  }

  if (!isString(value.agentId)) {
    throw new Error('Invalid agentId')
  }

  if (!isDifficulty(value.difficulty)) {
    throw new Error('Invalid difficulty')
  }

  assertOptionalNumber(value.seed, 'seed')
  assertOptionalNumber(value.maxTicks, 'maxTicks')
  assertOptionalString(value.seasonCode, 'seasonCode')

  return {
    agentId: value.agentId,
    difficulty: value.difficulty,
    seed: isFiniteNumber(value.seed) ? value.seed : undefined,
    maxTicks: isFiniteNumber(value.maxTicks) ? value.maxTicks : undefined,
    seasonCode: isString(value.seasonCode) ? value.seasonCode : null,
  }
}

export function parseRunProgressPayload(value: unknown): RunnerProgressPayload {
  if (!isRecord(value)) {
    throw new Error('Invalid run progress payload')
  }

  if (!isString(value.runId)) {
    throw new Error('Invalid runId')
  }

  if (!isRunStatus(value.status)) {
    throw new Error('Invalid status')
  }

  assertOptionalString(value.startTime, 'startTime')
  assertOptionalString(value.endTime, 'endTime')
  assertOptionalNumber(value.durationMs, 'durationMs')
  assertOptionalNumber(value.currentTick, 'currentTick')
  assertOptionalNumber(value.maxTicks, 'maxTicks')
  assertOptionalNumber(value.score, 'score')
  assertOptionalNumber(value.wave, 'wave')
  assertOptionalNumber(value.maxWave, 'maxWave')
  assertOptionalNumber(value.towersBuilt, 'towersBuilt')
  assertOptionalNumber(value.enemiesKilled, 'enemiesKilled')
  assertOptionalNumber(value.damageDealt, 'damageDealt')
  assertOptionalNumber(value.damageTaken, 'damageTaken')
  assertOptionalBoolean(value.isLive, 'isLive')
  assertOptionalString(value.errorMessage, 'errorMessage')

  if (value.resources !== undefined && !isResources(value.resources)) {
    throw new Error('Invalid resources')
  }

  if (value.resultSummary !== undefined && !isResultSummary(value.resultSummary)) {
    throw new Error('Invalid resultSummary')
  }

  if (value.eventType !== undefined && !isRunEventType(value.eventType)) {
    throw new Error('Invalid eventType')
  }

  if (value.eventPayload !== undefined && !isRecord(value.eventPayload)) {
    throw new Error('Invalid eventPayload')
  }

  if (value.eventBatch !== undefined && (!Array.isArray(value.eventBatch) || !value.eventBatch.every(isEventBatchEntry))) {
    throw new Error('Invalid eventBatch')
  }

  if (value.snapshot !== undefined && !isReplaySnapshot(value.snapshot)) {
    throw new Error('Invalid snapshot')
  }

  if (value.snapshot !== undefined && !isFiniteNumber(value.currentTick)) {
    throw new Error('currentTick is required when snapshot is provided')
  }

  return {
    runId: value.runId,
    status: value.status,
    startTime: isString(value.startTime) ? value.startTime : undefined,
    endTime: isString(value.endTime) ? value.endTime : undefined,
    durationMs: isFiniteNumber(value.durationMs) ? value.durationMs : undefined,
    currentTick: isFiniteNumber(value.currentTick) ? value.currentTick : undefined,
    maxTicks: isFiniteNumber(value.maxTicks) ? value.maxTicks : undefined,
    score: isFiniteNumber(value.score) ? value.score : undefined,
    wave: isFiniteNumber(value.wave) ? value.wave : undefined,
    maxWave: isFiniteNumber(value.maxWave) ? value.maxWave : undefined,
    resources: isResources(value.resources) ? value.resources : undefined,
    towersBuilt: isFiniteNumber(value.towersBuilt) ? value.towersBuilt : undefined,
    enemiesKilled: isFiniteNumber(value.enemiesKilled) ? value.enemiesKilled : undefined,
    damageDealt: isFiniteNumber(value.damageDealt) ? value.damageDealt : undefined,
    damageTaken: isFiniteNumber(value.damageTaken) ? value.damageTaken : undefined,
    isLive: typeof value.isLive === 'boolean' ? value.isLive : undefined,
    errorMessage: isString(value.errorMessage) ? value.errorMessage : undefined,
    resultSummary: isResultSummary(value.resultSummary) ? value.resultSummary : undefined,
    eventType: isRunEventType(value.eventType) ? value.eventType : undefined,
    eventPayload: isRecord(value.eventPayload) ? value.eventPayload : undefined,
    eventBatch: Array.isArray(value.eventBatch) ? value.eventBatch.filter(isEventBatchEntry) : undefined,
    snapshot: isReplaySnapshot(value.snapshot) ? value.snapshot : undefined,
  }
}

export function parseSubmitActionPayload(value: unknown): RunnerSubmitActionPayload {
  if (!isRecord(value)) {
    throw new Error('Invalid submit action payload')
  }

  if (!isString(value.runId)) {
    throw new Error('Invalid runId')
  }

  if (!isRunnerActionIntent(value.action)) {
    throw new Error('Invalid action')
  }

  return {
    runId: value.runId,
    action: value.action,
  }
}