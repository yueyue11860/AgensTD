import type {
  ActionTargetKind,
  ActionType,
  CoreMapCell,
  CoreRunScenario,
  GameAction,
  GameObservation,
  ReportRunProgressPayload,
  RunResultSummary,
} from '../domain.ts'
import { mockCoreScenario } from '../mock-data.ts'
import { buildReportRunProgressPayload } from './reporting.ts'
import { createSimulator } from './simulator.ts'
import type { CompetitionRunRow } from '../supabase/runner.ts'

export interface WorkerActionPlanStep {
  actionType: ActionType
  targetKind: ActionTargetKind
  targetId: string
  payload?: Record<string, unknown>
}

export interface RunWorkerOptions {
  run: CompetitionRunRow
  maxSteps?: number
  startTime?: string
  actionPlan?: WorkerActionPlanStep[]
  reportProgress?: (payload: ReportRunProgressPayload) => Promise<unknown>
}

export interface RunWorkerResult {
  payloads: ReportRunProgressPayload[]
  finalSummary: RunResultSummary
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback
}

function findAutoplayBuildCell(cells: CoreMapCell[]) {
  return cells.find((cell) => cell.kind === 'build') ?? null
}

function toCoreScenario(run: CompetitionRunRow): CoreRunScenario {
  const summary = asObject(run.result_summary)
  const summaryResources = asObject(summary.resources)
  const summaryActionWindow = asObject(summary.actionWindow)

  return {
    ...mockCoreScenario,
    runId: run.id,
    rulesVersion: asString(summary.rulesVersion, mockCoreScenario.rulesVersion),
    title: asString(summary.title, mockCoreScenario.title),
    difficulty: run.difficulty,
    seed: run.seed,
    zoneName: asString(summary.zoneName, mockCoreScenario.zoneName),
    currentNode: asString(summary.currentNode, mockCoreScenario.currentNode),
    waveLabel: asString(summary.waveLabel, mockCoreScenario.waveLabel),
    currentTick: run.current_tick,
    maxTicks: run.max_ticks,
    score: run.score,
    fortressIntegrity: asNumber(summary.fortressIntegrity, mockCoreScenario.fortressIntegrity),
    maintenanceDebt: asNumber(summary.maintenanceDebt, mockCoreScenario.maintenanceDebt),
    routePressure: asString(summary.routePressure, mockCoreScenario.routePressure),
    resources: {
      ...mockCoreScenario.resources,
      ...run.resources,
      ...summaryResources,
    },
    supportedTowerCores: asArray(summary.supportedTowerCores, mockCoreScenario.supportedTowerCores),
    routeNodes: asArray(summary.routeNodes, mockCoreScenario.routeNodes),
    cells: asArray(summary.cells, mockCoreScenario.cells),
    towers: asArray(summary.towers, mockCoreScenario.towers),
    enemies: asArray(summary.enemies, mockCoreScenario.enemies),
    relics: asArray(summary.relics, mockCoreScenario.relics),
    buildQueue: asArray(summary.buildQueue, mockCoreScenario.buildQueue),
    actionWindow: {
      ...mockCoreScenario.actionWindow,
      ...summaryActionWindow,
      options: asArray(summaryActionWindow.options, mockCoreScenario.actionWindow.options),
      quickActions: asArray(summaryActionWindow.quickActions, mockCoreScenario.actionWindow.quickActions),
    },
    routeForecast: asArray(summary.routeForecast, mockCoreScenario.routeForecast),
    objectiveStack: asArray(summary.objectiveStack, mockCoreScenario.objectiveStack),
  }
}

function createAutoplayAction(observation: GameObservation): GameAction {
  const readySlot = observation.scenario.actionWindow.quickActions.find((item) => item.availability === 'ready')

  if (!readySlot) {
    return {
      action_type: 'NO_OP',
      target_kind: 'global',
      observation_version: observation.observation_version,
      issued_at_tick: observation.tick,
    }
  }

  const autoplayBuildCell = readySlot.targetKind === 'cell'
    ? findAutoplayBuildCell(observation.scenario.cells)
    : null

  return {
    action_type: readySlot.actionType,
    target_kind: readySlot.targetKind,
    target_id: readySlot.targetKind === 'tower'
      ? (readySlot.targetId ?? observation.scenario.towers[0]?.id)
      : (readySlot.targetId ?? readySlot.actionId),
    ...(autoplayBuildCell ? { target_cell: { x: autoplayBuildCell.x, y: autoplayBuildCell.y } } : {}),
    observation_version: observation.observation_version,
    issued_at_tick: observation.tick,
    payload: {
      slot: readySlot.key,
      label: readySlot.label,
      ...(readySlot.actionType === 'BUILD' && readySlot.targetId ? { core: readySlot.targetId } : {}),
    },
  }
}

function createPlannedAction(step: WorkerActionPlanStep, observation: GameObservation): GameAction {
  return {
    action_type: step.actionType,
    target_kind: step.targetKind,
    target_id: step.targetId,
    payload: step.payload,
    observation_version: observation.observation_version,
    issued_at_tick: observation.tick,
  }
}

export async function runCompetitionWorker(options: RunWorkerOptions): Promise<RunWorkerResult> {
  const { run, maxSteps = 6, startTime = new Date().toISOString(), actionPlan = [], reportProgress } = options
  const simulator = createSimulator({
    scenario: toCoreScenario(run),
    seed: run.seed,
  })
  const payloads: ReportRunProgressPayload[] = []

  const startedObservation = simulator.getObservation()
  const startedSummary = simulator.getResultSummary()
  const startedPayload = buildReportRunProgressPayload({
    runId: run.id,
    status: 'running',
    observation: startedObservation,
    summary: startedSummary,
    startTime,
    isLive: true,
  })
  payloads.push(startedPayload)

  if (reportProgress) {
    await reportProgress(startedPayload)
  }

  let finalSummary = startedSummary

  for (let index = 0; index < maxSteps; index += 1) {
    const observation = simulator.getObservation()
    const plannedStep = actionPlan[index]
    const action = plannedStep ? createPlannedAction(plannedStep, observation) : createAutoplayAction(observation)
    const result = simulator.step(action)
    finalSummary = result.summary

    const isCompleted = result.observation.tick >= result.observation.scenario.maxTicks || index === maxSteps - 1
    const payload = buildReportRunProgressPayload({
      runId: run.id,
      status: isCompleted ? 'completed' : 'running',
      observation: result.observation,
      summary: result.summary,
      snapshot: result.snapshot,
      actionResult: result.actionResult,
      events: result.events,
      startTime,
      endTime: isCompleted ? new Date().toISOString() : undefined,
      durationMs: isCompleted ? Math.max(0, result.observation.tick - startedObservation.tick) * 100 : undefined,
      isLive: !isCompleted,
    })
    payloads.push(payload)

    if (reportProgress) {
      await reportProgress(payload)
    }

    if (isCompleted) {
      break
    }
  }

  return {
    payloads,
    finalSummary,
  }
}