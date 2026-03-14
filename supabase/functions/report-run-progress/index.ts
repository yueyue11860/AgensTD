import { createClient } from 'jsr:@supabase/supabase-js@2'
import { parseRunProgressPayload } from '../_shared/run-contract.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-runner-secret',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const runnerSecret = Deno.env.get('RUNNER_SECRET') ?? Deno.env.get('SUPABASE_RUNNER_SECRET')
    const providedSecret = req.headers.get('x-runner-secret')

    if (!supabaseUrl || !supabaseServiceRoleKey || !runnerSecret) {
      throw new Error('Missing Supabase runtime secrets')
    }

    if (providedSecret !== runnerSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const body = parseRunProgressPayload(await req.json())

    const runPatch = {
      status: body.status,
      ...(body.startTime !== undefined ? { start_time: body.startTime } : {}),
      ...(body.endTime !== undefined ? { end_time: body.endTime } : {}),
      ...(body.durationMs !== undefined ? { duration_ms: body.durationMs } : {}),
      ...(body.currentTick !== undefined ? { current_tick: body.currentTick } : {}),
      ...(body.maxTicks !== undefined ? { max_ticks: body.maxTicks } : {}),
      ...(body.score !== undefined ? { score: body.score } : {}),
      ...(body.wave !== undefined ? { wave: body.wave } : {}),
      ...(body.maxWave !== undefined ? { max_wave: body.maxWave } : {}),
      ...(body.resources !== undefined ? { resources: body.resources } : {}),
      ...(body.towersBuilt !== undefined ? { towers_built: body.towersBuilt } : {}),
      ...(body.enemiesKilled !== undefined ? { enemies_killed: body.enemiesKilled } : {}),
      ...(body.damageDealt !== undefined ? { damage_dealt: body.damageDealt } : {}),
      ...(body.damageTaken !== undefined ? { damage_taken: body.damageTaken } : {}),
      ...(body.isLive !== undefined ? { is_live: body.isLive } : {}),
      ...(body.errorMessage !== undefined ? { error_message: body.errorMessage } : {}),
      ...(body.resultSummary !== undefined ? { result_summary: body.resultSummary } : {}),
    }

    const { error: updateError } = await supabase
      .from('competition_runs')
      .update(runPatch)
      .eq('id', body.runId)

    if (updateError) {
      throw updateError
    }

    const eventRows = body.eventBatch && body.eventBatch.length > 0
      ? body.eventBatch.map((event) => ({
          run_id: body.runId,
          event_type: event.eventType,
          tick: event.tick ?? body.currentTick ?? null,
          payload: event.payload,
        }))
      : body.eventType
        ? [{
            run_id: body.runId,
            event_type: body.eventType,
            tick: body.currentTick ?? null,
            payload: body.eventPayload ?? {},
          }]
        : []

    if (eventRows.length > 0) {
      const { error: eventError } = await supabase
        .from('run_events')
        .insert(eventRows)

      if (eventError) {
        throw eventError
      }
    }

    if (body.snapshot) {
      const { error: snapshotError } = await supabase
        .from('run_snapshots')
        .upsert({
          run_id: body.runId,
          tick: body.currentTick ?? 0,
          snapshot: body.snapshot,
        }, { onConflict: 'run_id,tick' })

      if (snapshotError) {
        throw snapshotError
      }
    }

    return Response.json({ ok: true }, { headers: corsHeaders })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400, headers: corsHeaders },
    )
  }
})