import { fetchQueuedRun, reportRunProgress } from '../lib/supabase/runner.ts'
import { runCompetitionWorker } from '../lib/game/worker.ts'
import type { CompetitionRunRow } from '../lib/supabase/runner.ts'

function createDryRunFallback(runId?: string): CompetitionRunRow {
  const now = new Date().toISOString()

  return {
    id: runId ?? 'local-dry-run',
    run_code: 'LOCAL-DRY-RUN',
    agent_id: 'agent_local',
    season_id: null,
    triggered_by: null,
    difficulty: 'HARD',
    seed: 20260314,
    status: 'queued',
    start_time: null,
    end_time: null,
    duration_ms: null,
    current_tick: 0,
    max_ticks: 50000,
    score: 0,
    wave: 0,
    max_wave: 50,
    resources: {
      gold: 500,
      heat: 20,
      heat_limit: 100,
      mana: 100,
      mana_limit: 100,
      repair: 4,
      threat: 18,
      fortress: 100,
      fortress_max: 100,
    },
    towers_built: 0,
    enemies_killed: 0,
    damage_dealt: 0,
    damage_taken: 0,
    is_live: false,
    replay_public: false,
    view_count: 0,
    thumbnail_url: null,
    error_message: null,
    result_summary: {},
    created_at: now,
    updated_at: now,
  }
}

function readFlag(name: string) {
  return process.argv.includes(name)
}

function readOption(name: string) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return null
  }

  return process.argv[index + 1] ?? null
}

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const dryRun = readFlag('--dry-run')
  const runId = readOption('--run-id') ?? undefined
  const steps = parsePositiveInteger(readOption('--steps'), 6)

  let run: CompetitionRunRow | null = null

  try {
    run = await fetchQueuedRun({ runId })
  } catch (error) {
    if (!dryRun) {
      throw error
    }

    run = createDryRunFallback(runId)
  }

  if (!run) {
    if (!dryRun) {
      throw new Error(runId ? `Run not found: ${runId}` : 'No queued or running run available')
    }

    run = createDryRunFallback(runId)
  }

  const result = await runCompetitionWorker({
    run,
    maxSteps: steps,
    reportProgress: dryRun ? undefined : reportRunProgress,
  })

  console.log(JSON.stringify({
    dryRun,
    runId: run.id,
    status: run.status,
    steps,
    payloadCount: result.payloads.length,
    finalWaveLabel: result.finalSummary.waveLabel,
    finalScore: result.finalSummary.observation?.scenario.score ?? null,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})