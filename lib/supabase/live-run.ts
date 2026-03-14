import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mockCoreScenario,
  mockCoreSnapshots,
  type CoreRunScenario,
  type ReplaySnapshot,
} from '@/lib/mock-data'
import type { Database, Json } from '@/lib/supabase/database.types'

interface FetchLiveRunScenarioOptions {
  difficulty?: CoreRunScenario['difficulty']
}

interface LiveRunScenarioData {
  runId: string | null
  scenario: CoreRunScenario
  snapshots: ReplaySnapshot[]
}

export interface LiveRunScenarioResult {
  data: LiveRunScenarioData
  error: string | null
}

function asObject(value: Json | null | undefined) {
  return typeof value === 'object' && value && !Array.isArray(value) ? value : {}
}

function asArray<T>(value: Json | null | undefined, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function createFallbackScenario(difficulty?: CoreRunScenario['difficulty']) {
  return difficulty ? { ...mockCoreScenario, difficulty } : mockCoreScenario
}

function mapScenarioFromRun(
  run: Database['public']['Tables']['competition_runs']['Row'],
  agentName: string,
): CoreRunScenario {
  const summary = asObject(run.result_summary)
  const summaryResources = asObject(summary.resources as Json)
  const actionWindow = asObject(summary.actionWindow as Json)

  return {
    ...mockCoreScenario,
    runId: run.id,
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
    routeNodes: asArray(summary.routeNodes as Json, mockCoreScenario.routeNodes),
    cells: asArray(summary.cells as Json, mockCoreScenario.cells),
    towers: asArray(summary.towers as Json, mockCoreScenario.towers),
    enemies: asArray(summary.enemies as Json, mockCoreScenario.enemies),
    relics: asArray(summary.relics as Json, mockCoreScenario.relics),
    buildQueue: asArray(summary.buildQueue as Json, mockCoreScenario.buildQueue),
    actionWindow: {
      type: asString(actionWindow.type, mockCoreScenario.actionWindow.type),
      deadlineMs: asNumber(actionWindow.deadlineMs, mockCoreScenario.actionWindow.deadlineMs),
      summary: asString(actionWindow.summary, mockCoreScenario.actionWindow.summary),
      options: asArray(actionWindow.options as Json, mockCoreScenario.actionWindow.options),
      quickActions: asArray(actionWindow.quickActions as Json, mockCoreScenario.actionWindow.quickActions),
    },
    routeForecast: asArray(summary.routeForecast as Json, mockCoreScenario.routeForecast),
    objectiveStack: asArray(summary.objectiveStack as Json, mockCoreScenario.objectiveStack),
  }
}

function mapSnapshotsFromRows(rows: Database['public']['Tables']['run_snapshots']['Row'][]): ReplaySnapshot[] {
  if (rows.length === 0) {
    return mockCoreSnapshots
  }

  return rows.map((row) => {
    const snapshot = asObject(row.snapshot)
    const gameState = asObject(snapshot.game_state as Json)

    return {
      tick: row.tick,
      timestamp: asString(snapshot.timestamp, row.created_at),
      game_state: {
        resources: {
          ...mockCoreSnapshots[0].game_state.resources,
          ...asObject(gameState.resources as Json),
        },
        towers: asArray(gameState.towers as Json, []),
        enemies: asArray(gameState.enemies as Json, []),
        wave: asNumber(gameState.wave, 0),
        score: asNumber(gameState.score, 0),
      },
      thumbnail: typeof snapshot.thumbnail === 'string' ? snapshot.thumbnail : undefined,
    }
  })
}

export async function fetchLiveRunScenario(
  client: SupabaseClient<Database>,
  options: FetchLiveRunScenarioOptions = {},
): Promise<LiveRunScenarioResult> {
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
  const fallbackScenario = createFallbackScenario(options.difficulty)

  if (runError) {
    return {
      data: {
        runId: null,
        scenario: fallbackScenario,
        snapshots: mockCoreSnapshots,
      },
      error: runError.message,
    }
  }

  const run = runs?.[0] ?? null

  if (!run) {
    return {
      data: {
        runId: null,
        scenario: fallbackScenario,
        snapshots: mockCoreSnapshots,
      },
      error: null,
    }
  }

  const [{ data: agent }, { data: snapshots, error: snapshotError }] = await Promise.all([
    client.from('agents').select('name').eq('id', run.agent_id).maybeSingle(),
    client
      .from('run_snapshots')
      .select('*')
      .eq('run_id', run.id)
      .order('tick', { ascending: true })
      .limit(24),
  ])

  return {
    data: {
      runId: run.id,
      scenario: mapScenarioFromRun(run, agent?.name ?? mockCoreScenario.agentName),
      snapshots: snapshotError ? mockCoreSnapshots : mapSnapshotsFromRows(snapshots ?? []),
    },
    error: snapshotError?.message ?? null,
  }
}