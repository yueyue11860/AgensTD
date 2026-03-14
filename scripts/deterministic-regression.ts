import { createHash } from 'node:crypto'
import { createSimulator } from '../lib/game/simulator.ts'
import { buildReportRunProgressPayload } from '../lib/game/reporting.ts'
import type { ActionTargetKind, ActionType, GameAction } from '../lib/domain.ts'

interface PlannedAction {
  actionType: ActionType
  targetKind: ActionTargetKind
  targetId: string
  payload?: Record<string, unknown>
}

const FIXED_SEED = 20260314
const EXPECTED_SUMMARY_HASH: string = 'eca62c2cb60115d6d09347ea9b43de84416ec435f52b161657cc56ab88cd8be7'
const EXPECTED_SNAPSHOT_HASH: string = '5d4d4006528ea89122fd0032df9d34dae66a8b866c34899836c2b9fe52eb6e1c'
const EXPECTED_REPORT_HASH: string = '459d32d19b748b8528fc8a8f5c9d3ac3efa0b4384110ac23bb30b743b5ab5bab'

const ACTION_PLAN: PlannedAction[] = [
  {
    actionType: 'BUILD',
    targetKind: 'cell',
    targetId: 'cell-build-a1',
    payload: { core: 'BALLISTA', slot: 'Q' },
  },
  {
    actionType: 'CAST',
    targetKind: 'enemy',
    targetId: 'enemy-wave-1',
    payload: { spell: 'heat_vent', slot: 'W' },
  },
  {
    actionType: 'BUY',
    targetKind: 'shop',
    targetId: 'shop-repair-pack',
    payload: { item: 'repair_pack' },
  },
  {
    actionType: 'CHOOSE_OPTION',
    targetKind: 'option',
    targetId: 'option-fortify-route',
    payload: { option: 'fortify_route' },
  },
  {
    actionType: 'UPGRADE',
    targetKind: 'tower',
    targetId: 'tower-ballista-a1',
    payload: { module: 'piercing_core' },
  },
  {
    actionType: 'REPAIR',
    targetKind: 'global',
    targetId: 'fortress-core',
  },
]

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)

    return `{${entries.join(',')}}`
  }

  return JSON.stringify(value)
}

function hashValue(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function materializeAction(plan: PlannedAction, observationVersion: number, tick: number): GameAction {
  return {
    action_type: plan.actionType,
    target_kind: plan.targetKind,
    target_id: plan.targetId,
    payload: plan.payload,
    observation_version: observationVersion,
    issued_at_tick: tick,
  }
}

function runScenario() {
  const simulator = createSimulator({ seed: FIXED_SEED })
  const allEvents = []
  let lastResult: ReturnType<typeof simulator.step> | null = null

  for (const plan of ACTION_PLAN) {
    const observation = simulator.getObservation()
    const result = simulator.step(materializeAction(plan, observation.observation_version, observation.tick))

    if (!result.actionResult.accepted) {
      throw new Error(`Action ${plan.actionType} was rejected: ${result.actionResult.validation_code ?? result.actionResult.reason ?? 'unknown'}`)
    }

    allEvents.push(...result.events)
    lastResult = result
  }

  if (!lastResult) {
    throw new Error('No deterministic results produced')
  }

  const reportPayload = buildReportRunProgressPayload({
    runId: lastResult.observation.run_id,
    status: 'running',
    observation: lastResult.observation,
    summary: lastResult.summary,
    snapshot: lastResult.snapshot,
    actionResult: lastResult.actionResult,
    events: allEvents,
    isLive: true,
  })

  return {
    summaryHash: hashValue(lastResult.summary),
    snapshotHash: hashValue(lastResult.snapshot),
    reportHash: hashValue(reportPayload),
    summary: lastResult.summary,
    snapshot: lastResult.snapshot,
    reportPayload,
  }
}

function assertEqual(label: string, left: string, right: string) {
  if (left !== right) {
    throw new Error(`${label} mismatch: ${left} !== ${right}`)
  }
}

function assertExpected(label: string, actual: string, expected: string) {
  if (expected === 'TO_BE_FILLED') {
    throw new Error(`BASELINE_MISSING:${label}:${actual}`)
  }

  if (actual !== expected) {
    throw new Error(`${label} baseline changed: expected ${expected}, got ${actual}`)
  }
}

const first = runScenario()
const second = runScenario()

if (
  EXPECTED_SUMMARY_HASH === 'TO_BE_FILLED'
  || EXPECTED_SNAPSHOT_HASH === 'TO_BE_FILLED'
  || EXPECTED_REPORT_HASH === 'TO_BE_FILLED'
) {
  console.log(JSON.stringify({
    seed: FIXED_SEED,
    actionCount: ACTION_PLAN.length,
    summaryHash: first.summaryHash,
    snapshotHash: first.snapshotHash,
    reportHash: first.reportHash,
  }, null, 2))
}

assertEqual('summaryHash', first.summaryHash, second.summaryHash)
assertEqual('snapshotHash', first.snapshotHash, second.snapshotHash)
assertEqual('reportHash', first.reportHash, second.reportHash)

assertExpected('summaryHash', first.summaryHash, EXPECTED_SUMMARY_HASH)
assertExpected('snapshotHash', first.snapshotHash, EXPECTED_SNAPSHOT_HASH)
assertExpected('reportHash', first.reportHash, EXPECTED_REPORT_HASH)

console.log(JSON.stringify({
  seed: FIXED_SEED,
  actionCount: ACTION_PLAN.length,
  summaryHash: first.summaryHash,
  snapshotHash: first.snapshotHash,
  reportHash: first.reportHash,
}, null, 2))