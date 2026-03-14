import type {
  CoreReplaySnapshot,
  GameActionResult,
  GameObservation,
  ReportRunEventEntry,
  ReportRunProgressPayload,
  RunEventPayload,
  RunEventType,
  RunResultSummary,
  RunStatus,
  SimulationEvent,
} from '../domain.ts'

function parseWaveNumber(label: string) {
  const match = label.match(/Wave\s+(\d+)/i)
  return match ? Number(match[1]) : 1
}

function mapSimulationEventTypeToRunEventType(type: SimulationEvent['type']): RunEventType {
  switch (type) {
    case 'wave_started':
    case 'wave_resolved':
    case 'phase_changed':
      return 'milestone'
    case 'run_completed':
      return 'completed'
    case 'run_failed':
      return 'failed'
    default:
      return 'tick'
  }
}

export function buildRunEventPayload(options: {
  observation: GameObservation
  summary: RunResultSummary
  snapshot?: CoreReplaySnapshot
  actionResult?: GameActionResult
  event?: SimulationEvent
}): RunEventPayload {
  const { observation, summary, snapshot, actionResult, event } = options

  return {
    difficulty: observation.difficulty,
    seed: observation.seed,
    max_ticks: observation.scenario.maxTicks,
    phase: observation.phase,
    summary,
    snapshot,
    observation,
    action: actionResult?.action,
    actionResult,
    event,
  }
}

export function buildRunEventBatch(options: {
  observation: GameObservation
  summary: RunResultSummary
  snapshot?: CoreReplaySnapshot
  actionResult?: GameActionResult
  events: SimulationEvent[]
}): ReportRunEventEntry[] {
  const { observation, summary, snapshot, actionResult, events } = options

  return events.map((event) => ({
    eventType: mapSimulationEventTypeToRunEventType(event.type),
    tick: event.tick,
    payload: buildRunEventPayload({
      observation,
      summary,
      snapshot,
      actionResult,
      event,
    }),
  }))
}

export function buildReportRunProgressPayload(options: {
  runId: string
  status: RunStatus
  observation: GameObservation
  summary: RunResultSummary
  snapshot?: CoreReplaySnapshot
  actionResult?: GameActionResult
  events?: SimulationEvent[]
  startTime?: string
  endTime?: string
  durationMs?: number
  isLive?: boolean
  errorMessage?: string
}): ReportRunProgressPayload {
  const {
    runId,
    status,
    observation,
    summary,
    snapshot,
    actionResult,
    events = [],
    startTime,
    endTime,
    durationMs,
    isLive,
    errorMessage,
  } = options
  const scenario = observation.scenario
  const eventBatch = buildRunEventBatch({
    observation,
    summary,
    snapshot,
    actionResult,
    events,
  })
  const lastEvent = eventBatch.at(-1)

  return {
    runId,
    status,
    startTime,
    endTime,
    durationMs,
    currentTick: observation.tick,
    maxTicks: scenario.maxTicks,
    score: scenario.score,
    wave: parseWaveNumber(scenario.waveLabel),
    resources: { ...scenario.resources },
    towersBuilt: scenario.towers.length,
    isLive,
    errorMessage,
    resultSummary: summary,
    eventType: lastEvent?.eventType,
    eventPayload: lastEvent?.payload,
    eventBatch,
    snapshot,
  }
}