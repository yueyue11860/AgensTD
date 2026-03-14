import { fetchQueuedRun, reportRunProgress } from '../lib/supabase/runner.ts'
import { runCompetitionWorker } from '../lib/game/worker.ts'
import type { CompetitionRunRow } from '../lib/supabase/runner.ts'

function createDryRunFallback(index: number): CompetitionRunRow {
  const now = new Date().toISOString()

  return {
    id: `local-loop-${index + 1}`,
    run_code: `LOCAL-LOOP-${index + 1}`,
    agent_id: 'agent_local',
    season_id: null,
    triggered_by: null,
    difficulty: 'HARD',
    seed: 20260314 + index,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let shouldStop = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shouldStop = true
  })
}

async function processOneRun(maxSteps: number, dryRun: boolean, processed: number) {
  let run: CompetitionRunRow | null = null

  try {
    run = await fetchQueuedRun()
  } catch (error) {
    if (!dryRun) {
      throw error
    }

    run = createDryRunFallback(processed)
  }

  if (!run) {
    if (dryRun) {
      run = createDryRunFallback(processed)
    } else {
      return null
    }
  }

  const result = await runCompetitionWorker({
    run,
    maxSteps,
    reportProgress: dryRun ? undefined : reportRunProgress,
  })

  return {
    dryRun,
    runId: run.id,
    status: result.payloads.at(-1)?.status ?? run.status,
    payloadCount: result.payloads.length,
    finalScore: result.finalSummary.observation?.scenario.score ?? null,
    finalWaveLabel: result.finalSummary.waveLabel ?? null,
  }
}

async function main() {
  const once = readFlag('--once')
  const dryRun = readFlag('--dry-run')
  const maxRuns = once ? parsePositiveInteger(readOption('--max-runs'), 1) : parsePositiveInteger(readOption('--max-runs'), Number.MAX_SAFE_INTEGER)
  const maxSteps = parsePositiveInteger(readOption('--steps'), 6)
  const pollMs = parsePositiveInteger(readOption('--poll-ms'), 5000)

  let processed = 0

  while (!shouldStop) {
    const outcome = await processOneRun(maxSteps, dryRun, processed)

    if (outcome) {
      processed += 1
      console.log(JSON.stringify({
        processed,
        ...outcome,
      }, null, 2))
    } else if (once || processed >= maxRuns) {
      console.log(JSON.stringify({
        processed,
        dryRun,
        message: 'No queued or running runs available',
      }, null, 2))
      break
    }

    if (processed >= maxRuns) {
      break
    }

    if (once) {
      break
    }

    await sleep(pollMs)
  }

  console.log(JSON.stringify({
    processed,
    dryRun,
    stopped: shouldStop,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})