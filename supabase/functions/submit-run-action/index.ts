import { createClient } from 'jsr:@supabase/supabase-js@2'
import { createSimulator } from '../../../lib/game/simulator.ts'
import { buildReportRunProgressPayload } from '../../../lib/game/reporting.ts'
import { mockCoreScenario } from '../../../lib/mock-data.ts'
import { parseSubmitActionPayload } from '../_shared/run-contract.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asPhase(value: unknown) {
  return value === 'PREP' || value === 'COMBAT' || value === 'RESOLUTION' || value === 'DECISION' ? value : 'PREP'
}

function isFreshRunSummary(value: unknown) {
  return Object.keys(asObject(value)).length === 0
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error)
    } catch {
      return 'Unknown object error'
    }
  }

  return String(error)
}

function createFreshScenarioFromRun(run: Record<string, unknown>) {
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
  const scenario = {
    ...mockCoreScenario,
    runId: asString(run.id, mockCoreScenario.runId),
    difficulty: asString(run.difficulty, mockCoreScenario.difficulty) as typeof mockCoreScenario.difficulty,
    seed: asNumber(run.seed, mockCoreScenario.seed),
    currentTick: asNumber(run.current_tick, 0),
    maxTicks: asNumber(run.max_ticks, mockCoreScenario.maxTicks),
    score: asNumber(run.score, 0),
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
      { id: 'fresh-open-2', label: '保留法能与维修点', eta: '首波前', reason: '第一波更需要容错而不是贪收益。' },
    ],
    objectiveStack: [
      { label: '站稳开局', detail: '至少部署 1 座建筑，避免第一轮直接漏怪。', severity: 'critical' as const },
      { label: '保资源', detail: '维修点与法能都不要在开局一次性花空。', severity: 'warning' as const },
      { label: '看路线', detail: '首个节点决定后续转型窗口。', severity: 'info' as const },
    ],
  }

  return createSimulator({
    scenario,
    phase: 'PREP',
    seed: scenario.seed,
  }).getObservation().scenario
}

function mapScenarioFromRun(run: Record<string, unknown>) {
  if (isFreshRunSummary(run.result_summary)) {
    return createFreshScenarioFromRun(run)
  }

  const summary = asObject(run.result_summary)
  const summaryResources = asObject(summary.resources)
  const actionWindow = asObject(summary.actionWindow)

  return {
    ...mockCoreScenario,
    runId: asString(run.id, mockCoreScenario.runId),
    rulesVersion: asString(summary.rulesVersion, mockCoreScenario.rulesVersion),
    title: asString(summary.title, mockCoreScenario.title),
    difficulty: asString(run.difficulty, mockCoreScenario.difficulty) as typeof mockCoreScenario.difficulty,
    seed: asNumber(run.seed, mockCoreScenario.seed),
    zoneName: asString(summary.zoneName, mockCoreScenario.zoneName),
    currentNode: asString(summary.currentNode, mockCoreScenario.currentNode),
    waveLabel: asString(summary.waveLabel, mockCoreScenario.waveLabel),
    currentTick: asNumber(run.current_tick, mockCoreScenario.currentTick),
    maxTicks: asNumber(run.max_ticks, mockCoreScenario.maxTicks),
    score: asNumber(run.score, mockCoreScenario.score),
    fortressIntegrity: asNumber(summary.fortressIntegrity, mockCoreScenario.fortressIntegrity),
    maintenanceDebt: asNumber(summary.maintenanceDebt, mockCoreScenario.maintenanceDebt),
    routePressure: asString(summary.routePressure, mockCoreScenario.routePressure),
    resources: {
      ...mockCoreScenario.resources,
      ...asObject(run.resources),
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
      ...actionWindow,
      options: asArray(actionWindow.options, mockCoreScenario.actionWindow.options),
      quickActions: asArray(actionWindow.quickActions, mockCoreScenario.actionWindow.quickActions),
    },
    routeForecast: asArray(summary.routeForecast, mockCoreScenario.routeForecast),
    objectiveStack: asArray(summary.objectiveStack, mockCoreScenario.objectiveStack),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const payload = parseSubmitActionPayload(await req.json())

    const { data: run, error: runError } = await supabase
      .from('competition_runs')
      .select('*')
      .eq('id', payload.runId)
      .maybeSingle()

    if (runError || !run) {
      throw runError ?? new Error('Run not found')
    }

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'timeout') {
      return Response.json(
        { ok: false, runId: payload.runId, status: run.status, accepted: false, reason: 'run already finalized' },
        { status: 409, headers: corsHeaders },
      )
    }

    const summary = asObject(run.result_summary)
    const scenario = mapScenarioFromRun(run as unknown as Record<string, unknown>)
    const phase = asPhase(summary.phase)
    const observationVersion = asNumber(summary.observationVersion, 1)
    const issuedAtTick = asNumber(run.current_tick, 0)

    const simulator = createSimulator({
      scenario,
      phase,
      seed: asNumber(run.seed, mockCoreScenario.seed),
    })

    const result = simulator.step({
      action_type: payload.action.actionType,
      target_kind: payload.action.targetKind,
      target_id: payload.action.targetId,
      target_cell: payload.action.targetCell,
      payload: payload.action.payload,
      observation_version: observationVersion,
      issued_at_tick: issuedAtTick,
    })

    const status = result.events.some((event) => event.type === 'run_failed')
      ? 'failed'
      : result.events.some((event) => event.type === 'run_completed') || result.observation.tick >= result.observation.scenario.maxTicks
        ? 'completed'
        : 'running'

    const reportPayload = buildReportRunProgressPayload({
      runId: payload.runId,
      status,
      observation: result.observation,
      summary: result.summary,
      snapshot: result.snapshot,
      actionResult: result.actionResult,
      events: result.events,
      isLive: status === 'running',
      endTime: status === 'running' ? undefined : new Date().toISOString(),
    })

    const runPatch = {
      status,
      current_tick: reportPayload.currentTick,
      max_ticks: reportPayload.maxTicks,
      score: reportPayload.score,
      wave: reportPayload.wave,
      resources: reportPayload.resources,
      towers_built: reportPayload.towersBuilt,
      is_live: status === 'running',
      result_summary: reportPayload.resultSummary,
      ...(status !== 'running' ? { end_time: new Date().toISOString() } : {}),
    }

    const { error: updateError } = await supabase
      .from('competition_runs')
      .update(runPatch)
      .eq('id', payload.runId)

    if (updateError) {
      throw updateError
    }

    const { error: actionLogError } = await supabase
      .from('run_actions')
      .insert({
        run_id: payload.runId,
        tick: reportPayload.currentTick ?? 0,
        action: result.actionResult.action,
        accepted: result.actionResult.accepted,
        validation_code: result.actionResult.validation_code ?? null,
        reason: result.actionResult.reason ?? null,
      })

    if (actionLogError) {
      throw actionLogError
    }

    if (reportPayload.eventBatch && reportPayload.eventBatch.length > 0) {
      const { error: eventError } = await supabase
        .from('run_events')
        .insert(
          reportPayload.eventBatch.map((event) => ({
            run_id: payload.runId,
            event_type: event.eventType,
            tick: event.tick ?? reportPayload.currentTick ?? null,
            payload: event.payload,
          })),
        )

      if (eventError) {
        throw eventError
      }
    }

    if (reportPayload.snapshot) {
      const { error: snapshotError } = await supabase
        .from('run_snapshots')
        .upsert({
          run_id: payload.runId,
          tick: reportPayload.currentTick ?? 0,
          snapshot: reportPayload.snapshot,
        }, { onConflict: 'run_id,tick' })

      if (snapshotError) {
        throw snapshotError
      }
    }

    return Response.json(
      {
        ok: true,
        runId: payload.runId,
        status,
        accepted: result.actionResult.accepted,
        validationCode: result.actionResult.validation_code,
        reason: result.actionResult.reason,
      },
      { headers: corsHeaders },
    )
  } catch (error) {
    return Response.json(
      { error: serializeError(error) },
      { status: 400, headers: corsHeaders },
    )
  }
})