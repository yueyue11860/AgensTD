import { getSupabaseAdminClient } from '../lib/supabase/admin.ts'
import { createSimulator } from '../lib/game/simulator.ts'
import { mockCoreScenario } from '../lib/mock-data.ts'

type QuickActionSlot = {
  key?: string
  actionId?: string
  actionType?: string
  targetKind?: string
  label?: string
  availability?: string
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args.set(token, 'true')
      continue
    }

    args.set(token, next)
    index += 1
  }

  return args
}

function findFirstBuildCell(cells: Array<Record<string, unknown>>) {
  const buildCell = cells.find((cell) => cell.kind === 'build')
  if (!buildCell) {
    return undefined
  }

  return {
    x: Number(buildCell.x),
    y: Number(buildCell.y),
  }
}

function buildFreshRunFallbackScenario() {
  const routeNodes = mockCoreScenario.routeNodes.map((node, index) => ({
    ...node,
    cleared: false,
    active: index === 0,
  }))

  return createSimulator({
    scenario: {
      ...mockCoreScenario,
      currentTick: 0,
      score: 0,
      waveLabel: 'Wave 1',
      currentNode: routeNodes[0]?.title ?? '开局部署',
      routePressure: 'Run 已创建。先落下第一座建筑，再决定首轮路线。',
      maintenanceDebt: 0,
      routeNodes,
      towers: [],
      enemies: [],
      relics: [],
      buildQueue: [
        { id: 'fresh-open-1', label: '落第一座建筑', eta: '当前窗口', reason: '先定主轴，再决定是补单体、范围还是功能位。' },
      ],
      actionWindow: {
        ...mockCoreScenario.actionWindow,
        options: [],
        quickActions: [],
      },
    },
    phase: 'PREP',
    seed: mockCoreScenario.seed,
  }).getObservation().scenario
}

async function findRun(client: NonNullable<ReturnType<typeof getSupabaseAdminClient>>, runId?: string): Promise<Record<string, unknown> | null> {
  if (runId) {
    const { data, error } = await client
      .from('competition_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle()

    if (error) {
      throw error
    }

    return (data as Record<string, unknown> | null) ?? null
  }

  const { data, error } = await client
    .from('competition_runs')
    .select('*')
    .in('status', ['running', 'queued'])
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  return (data?.[0] as Record<string, unknown> | null) ?? null
}

async function findAgentId(client: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await client
    .from('agents')
    .select('id')
    .eq('status', 'active')
    .order('last_active_at', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  return (data?.[0] as { id?: string } | undefined)?.id ?? null
}

async function createRun(
  client: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  difficulty: string,
  agentId?: string,
) {
  const resolvedAgentId = agentId ?? await findAgentId(client)

  if (!resolvedAgentId) {
    throw new Error('No active agent found for enqueue-run verification')
  }

  const { data, error } = await client.functions.invoke('enqueue-run', {
    body: {
      agentId: resolvedAgentId,
      difficulty,
    },
  })

  if (error) {
    throw error
  }

  return data as { runId: string; runCode: string; status: string }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const client = getSupabaseAdminClient()

  if (!client) {
    throw new Error('Missing Supabase service environment. Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  }

  const requestedRunId = args.get('--run-id')
  const actionIdArg = args.get('--action-id')
  const difficulty = args.get('--difficulty') ?? 'HELL'
  const createIfMissing = args.get('--create-if-missing') !== 'false'

  let run = await findRun(client, requestedRunId)
  let createdRunCode: string | null = null

  if (!run && createIfMissing) {
    const created = await createRun(client, difficulty, args.get('--agent-id') ?? undefined)
    createdRunCode = created.runCode
    run = await findRun(client, created.runId)
  }

  if (!run) {
    throw new Error('No queued/running run found. You can pass --run-id or allow auto creation with --create-if-missing true')
  }

  const summary = asObject(run.result_summary)
  const actionWindow = asObject(summary.actionWindow)
  const freshScenario = buildFreshRunFallbackScenario()
  const quickActions = asArray<QuickActionSlot>(actionWindow.quickActions)
  const resolvedQuickActions = quickActions.length > 0
    ? quickActions
    : freshScenario.actionWindow.quickActions

  const selectedSlot = actionIdArg
    ? resolvedQuickActions.find((slot) => slot.actionId === actionIdArg)
    : resolvedQuickActions.find((slot) => slot.availability === 'ready')

  if (!selectedSlot?.actionId || !selectedSlot.actionType || !selectedSlot.targetKind) {
    throw new Error('No valid ready quick action found for verification')
  }

  const towers = asArray<Record<string, unknown>>(summary.towers)
  const cells = asArray<Record<string, unknown>>(summary.cells)
  const resolvedTowers = towers.length > 0 ? towers : asArray<Record<string, unknown>>(freshScenario.towers as unknown)
  const resolvedCells = cells.length > 0 ? cells : asArray<Record<string, unknown>>(freshScenario.cells as unknown)
  const resolvedTargetId = selectedSlot.targetKind === 'tower'
    ? asString(resolvedTowers[0]?.id, selectedSlot.actionId)
    : selectedSlot.actionId
  const resolvedTargetCell = selectedSlot.targetKind === 'cell'
    ? findFirstBuildCell(resolvedCells)
    : undefined

  const payload = {
    runId: asString(run.id),
    action: {
      actionType: selectedSlot.actionType,
      targetKind: selectedSlot.targetKind,
      targetId: resolvedTargetId,
      targetCell: resolvedTargetCell,
      payload: {
        slot: selectedSlot.key,
        label: selectedSlot.label,
      },
    },
  }

  const { data, error } = await client.functions.invoke('submit-run-action', {
    body: payload,
  })

  if (error) {
    throw error
  }

  const { data: actionLog, error: actionLogError } = await client
    .from('run_actions')
    .select('*')
    .eq('run_id', asString(run.id))
    .order('created_at', { ascending: false })
    .limit(1)

  if (actionLogError) {
    throw actionLogError
  }

  console.log(JSON.stringify({
    createdRunCode,
    runId: asString(run.id),
    selectedAction: {
      actionId: selectedSlot.actionId,
      actionType: selectedSlot.actionType,
      targetKind: selectedSlot.targetKind,
      targetId: resolvedTargetId,
      targetCell: resolvedTargetCell ?? null,
    },
    result: data,
    latestActionLog: actionLog?.[0] ?? null,
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})