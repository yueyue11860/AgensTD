import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mockCoreScenario,
  mockCoreSnapshots,
  type CoreRunScenario,
} from '@/lib/mock-data'
import type { ActionValidationCode, ActionWindowType, CoreReplaySnapshot, RunActionLogEntry } from '@/lib/domain'
import { createSimulator } from '@/lib/game/simulator'
import type { Database } from '@/lib/supabase/database.types'

interface FetchLiveRunScenarioOptions {
  difficulty?: CoreRunScenario['difficulty']
  runId?: string
}

interface LiveRunScenarioData {
  runId: string | null
  scenario: CoreRunScenario
  snapshots: CoreReplaySnapshot[]
  recentActions: RunActionLogEntry[]
}

export interface LiveRunScenarioResult {
  data: LiveRunScenarioData
  error: string | null
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function asActionWindowType(value: unknown, fallback: ActionWindowType): ActionWindowType {
  return value === 'prep' || value === 'combat' || value === 'resolution' || value === 'decision'
    ? value
    : fallback
}

function isFreshRunSummary(value: unknown) {
  const summary = asObject(value)
  return Object.keys(summary).length === 0
}

function createFallbackScenario(difficulty?: CoreRunScenario['difficulty']) {
  return difficulty ? { ...mockCoreScenario, difficulty } : mockCoreScenario
}

function mapScenarioFromRun(
  run: Database['public']['Tables']['competition_runs']['Row'],
  agentName: string,
): CoreRunScenario {
  const summary = asObject(run.result_summary)
  const summaryResources = asObject(summary.resources)
  const actionWindow = asObject(summary.actionWindow)

  return {
    ...mockCoreScenario,
    runId: run.id,
    rulesVersion: asString(summary.rulesVersion, mockCoreScenario.rulesVersion),
    title: asString(summary.title, mockCoreScenario.title),
    agentName,
    difficulty: run.difficulty,
    seed: Number(run.seed),
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
      gold: asNumber(asObject(run.resources).gold, mockCoreScenario.resources.gold),
      heat: asNumber(summaryResources.heat, mockCoreScenario.resources.heat),
      heat_limit: asNumber(summaryResources.heat_limit, mockCoreScenario.resources.heat_limit),
      mana: asNumber(summaryResources.mana, mockCoreScenario.resources.mana),
      mana_limit: asNumber(summaryResources.mana_limit, mockCoreScenario.resources.mana_limit),
      repair: asNumber(summaryResources.repair, mockCoreScenario.resources.repair),
      threat: asNumber(summaryResources.threat, mockCoreScenario.resources.threat),
      fortress: asNumber(summaryResources.fortress, mockCoreScenario.resources.fortress),
      fortress_max: asNumber(summaryResources.fortress_max, mockCoreScenario.resources.fortress_max),
    },
    supportedTowerCores: asArray(summary.supportedTowerCores, mockCoreScenario.supportedTowerCores),
    routeNodes: asArray(summary.routeNodes, mockCoreScenario.routeNodes),
    cells: asArray(summary.cells, mockCoreScenario.cells),
    towers: asArray(summary.towers, mockCoreScenario.towers),
    enemies: asArray(summary.enemies, mockCoreScenario.enemies),
    relics: asArray(summary.relics, mockCoreScenario.relics),
    buildQueue: asArray(summary.buildQueue, mockCoreScenario.buildQueue),
    actionWindow: {
      type: asActionWindowType(actionWindow.type, mockCoreScenario.actionWindow.type),
      label: asString(actionWindow.label, mockCoreScenario.actionWindow.label),
      deadlineMs: asNumber(actionWindow.deadlineMs, mockCoreScenario.actionWindow.deadlineMs),
      summary: asString(actionWindow.summary, mockCoreScenario.actionWindow.summary),
      options: asArray(actionWindow.options, mockCoreScenario.actionWindow.options),
      quickActions: asArray(actionWindow.quickActions, mockCoreScenario.actionWindow.quickActions),
    },
    routeForecast: asArray(summary.routeForecast, mockCoreScenario.routeForecast),
    objectiveStack: asArray(summary.objectiveStack, mockCoreScenario.objectiveStack),
  }
}

function mapSnapshotsFromRows(rows: Database['public']['Tables']['run_snapshots']['Row'][]): CoreReplaySnapshot[] {
  if (rows.length === 0) {
    return mockCoreSnapshots
  }

  return rows.map((row) => {
    const snapshot = asObject(row.snapshot)
    const gameState = asObject(snapshot.game_state)

    return {
      tick: row.tick,
      timestamp: asString(snapshot.timestamp, row.created_at),
      game_state: {
        resources: {
          ...mockCoreSnapshots[0].game_state.resources,
          ...asObject(gameState.resources),
        },
        towers: asArray(gameState.towers, []),
        enemies: asArray(gameState.enemies, []),
        wave: asNumber(gameState.wave, 0),
        score: asNumber(gameState.score, 0),
        phase: gameState.phase === 'PREP' || gameState.phase === 'COMBAT' || gameState.phase === 'RESOLUTION' || gameState.phase === 'DECISION'
          ? gameState.phase
          : 'PREP',
        observation_version: asNumber(gameState.observation_version, 1),
      },
    }
  })
}

function mapRunActions(rows: Database['public']['Tables']['run_actions']['Row'][]): RunActionLogEntry[] {
  return rows.map((row) => ({
    id: row.id,
    tick: row.tick,
    action: {
      ...row.action,
      payload: row.action.payload ? { ...row.action.payload } : undefined,
      target_cell: row.action.target_cell ? { ...row.action.target_cell } : undefined,
    },
    accepted: row.accepted,
    validation_code: row.validation_code as ActionValidationCode | null | undefined,
    reason: row.reason,
    created_at: row.created_at,
  }))
}

function createFreshScenarioFromRun(run: Database['public']['Tables']['competition_runs']['Row'], agentName: string) {
  const runResources = asObject(run.resources)
  const resources = {
    ...mockCoreScenario.resources,
    gold: asNumber(runResources.gold, mockCoreScenario.resources.gold),
    heat: asNumber(runResources.heat, mockCoreScenario.resources.heat),
    heat_limit: asNumber(runResources.heat_limit, mockCoreScenario.resources.heat_limit),
    mana: asNumber(runResources.mana, mockCoreScenario.resources.mana),
    mana_limit: asNumber(runResources.mana_limit, mockCoreScenario.resources.mana_limit),
    repair: asNumber(runResources.repair, mockCoreScenario.resources.repair),
    threat: asNumber(runResources.threat, mockCoreScenario.resources.threat),
    fortress: asNumber(runResources.fortress, mockCoreScenario.resources.fortress),
    fortress_max: asNumber(runResources.fortress_max, mockCoreScenario.resources.fortress_max),
  }
  const routeNodes = mockCoreScenario.routeNodes.map((node, index) => ({
    ...node,
    cleared: false,
    active: index === 0,
  }))
  const scenario: CoreRunScenario = {
    ...mockCoreScenario,
    runId: run.id,
    agentName,
    difficulty: run.difficulty,
    seed: run.seed ?? mockCoreScenario.seed,
    currentTick: run.current_tick,
    maxTicks: run.max_ticks,
    score: run.score,
    waveLabel: 'Wave 1',
    fortressIntegrity: resources.fortress,
    maintenanceDebt: 0,
    currentNode: routeNodes[0]?.title ?? '开局部署',
    routePressure: 'Run 已创建。先落下第一座建筑，再决定首轮路线。',
    resources,
    routeNodes,
    towers: [],
    enemies: [],
    relics: [],
    buildQueue: [
      { id: 'fresh-open-1', label: '落第一座建筑', eta: '当前窗口', reason: '先定主轴，再决定是补单体、范围还是功能位。' },
      { id: 'fresh-open-2', label: '保留法能与维修点', eta: '首波前', reason: '在线 run 的第一波更需要容错而不是贪收益。' },
    ],
    objectiveStack: [
      { label: '站稳开局', detail: '至少部署 1 座建筑，避免第一轮直接漏怪。', severity: 'critical' },
      { label: '保资源', detail: '维修点与法能都不要在开局一次性花空。', severity: 'warning' },
      { label: '看路线', detail: '首个节点决定后续转型窗口。', severity: 'info' },
    ],
  }

  return createSimulator({
    scenario,
    phase: 'PREP',
    seed: scenario.seed,
  }).getObservation().scenario
}

export async function fetchLiveRunScenario(
  client: SupabaseClient<Database>,
  options: FetchLiveRunScenarioOptions = {},
): Promise<LiveRunScenarioResult> {
  const fallbackScenario = createFallbackScenario(options.difficulty)

  if (options.runId) {
    const { data: run, error: runError } = await client
      .from('competition_runs')
      .select('*')
      .eq('id', options.runId)
      .maybeSingle()

    if (runError) {
      return {
        data: {
          runId: null,
          scenario: fallbackScenario,
          snapshots: mockCoreSnapshots,
          recentActions: [],
        },
        error: runError.message,
      }
    }

    if (!run) {
      return {
        data: {
          runId: null,
          scenario: fallbackScenario,
          snapshots: mockCoreSnapshots,
          recentActions: [],
        },
        error: null,
      }
    }

    const typedRun = run as Database['public']['Tables']['competition_runs']['Row']

    const [{ data: agent }, { data: snapshots, error: snapshotError }, { data: actions, error: actionError }] = await Promise.all([
      client.from('agents').select('name').eq('id', typedRun.agent_id).maybeSingle(),
      client
        .from('run_snapshots')
        .select('*')
        .eq('run_id', typedRun.id)
        .order('tick', { ascending: true })
        .limit(24),
      client
        .from('run_actions')
        .select('*')
        .eq('run_id', typedRun.id)
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    const typedAgent = agent as { name?: string } | null
    const typedSnapshots = (snapshots ?? []) as Database['public']['Tables']['run_snapshots']['Row'][]
    const typedActions = (actions ?? []) as Database['public']['Tables']['run_actions']['Row'][]

    const mappedScenario = isFreshRunSummary(typedRun.result_summary)
      ? createFreshScenarioFromRun(typedRun, typedAgent?.name ?? mockCoreScenario.agentName)
      : mapScenarioFromRun(typedRun, typedAgent?.name ?? mockCoreScenario.agentName)

    return {
      data: {
        runId: typedRun.id,
        scenario: mappedScenario,
        snapshots: snapshotError ? mockCoreSnapshots : mapSnapshotsFromRows(typedSnapshots),
        recentActions: actionError ? [] : mapRunActions(typedActions),
      },
      error: snapshotError?.message ?? actionError?.message ?? null,
    }
  }

  let query = client
    .from('competition_runs')
    .select('*')
    .eq('is_live', true)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (options.difficulty) {
    query = query.eq('difficulty', options.difficulty)
  }

  const { data: runs, error: runError } = await query

  if (runError) {
    return {
      data: {
        runId: null,
        scenario: fallbackScenario,
        snapshots: mockCoreSnapshots,
        recentActions: [],
      },
      error: runError.message,
    }
  }

  const run = (runs?.[0] ?? null) as Database['public']['Tables']['competition_runs']['Row'] | null

  if (!run) {
    return {
      data: {
        runId: null,
        scenario: fallbackScenario,
        snapshots: mockCoreSnapshots,
        recentActions: [],
      },
      error: null,
    }
  }

  const [{ data: agent }, { data: snapshots, error: snapshotError }, { data: actions, error: actionError }] = await Promise.all([
    client.from('agents').select('name').eq('id', run.agent_id).maybeSingle(),
    client
      .from('run_snapshots')
      .select('*')
      .eq('run_id', run.id)
      .order('tick', { ascending: true })
      .limit(24),
    client
      .from('run_actions')
      .select('*')
      .eq('run_id', run.id)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  const typedAgent = agent as { name?: string } | null
  const typedSnapshots = (snapshots ?? []) as Database['public']['Tables']['run_snapshots']['Row'][]
  const typedActions = (actions ?? []) as Database['public']['Tables']['run_actions']['Row'][]

  const mappedScenario = isFreshRunSummary(run.result_summary)
    ? createFreshScenarioFromRun(run, typedAgent?.name ?? mockCoreScenario.agentName)
    : mapScenarioFromRun(run, typedAgent?.name ?? mockCoreScenario.agentName)

  return {
    data: {
      runId: run.id,
      scenario: mappedScenario,
      snapshots: snapshotError ? mockCoreSnapshots : mapSnapshotsFromRows(typedSnapshots),
      recentActions: actionError ? [] : mapRunActions(typedActions),
    },
    error: snapshotError?.message ?? actionError?.message ?? null,
  }
}