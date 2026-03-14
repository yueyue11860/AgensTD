import { createClient } from 'jsr:@supabase/supabase-js@2'

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
    const runnerSecret = Deno.env.get('SUPABASE_RUNNER_SECRET')
    const providedSecret = req.headers.get('x-runner-secret')

    if (!supabaseUrl || !supabaseServiceRoleKey || !runnerSecret) {
      throw new Error('Missing Supabase runtime secrets')
    }

    if (providedSecret !== runnerSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const body = await req.json()

    const runId = body.runId as string

    const runPatch = {
      status: body.status,
      start_time: body.startTime ?? undefined,
      end_time: body.endTime ?? undefined,
      duration_ms: body.durationMs ?? undefined,
      current_tick: body.currentTick ?? 0,
      max_ticks: body.maxTicks ?? 50000,
      score: body.score ?? 0,
      wave: body.wave ?? 0,
      max_wave: body.maxWave ?? 50,
      resources: body.resources ?? undefined,
      towers_built: body.towersBuilt ?? 0,
      enemies_killed: body.enemiesKilled ?? 0,
      damage_dealt: body.damageDealt ?? 0,
      damage_taken: body.damageTaken ?? 0,
      is_live: body.isLive ?? false,
      error_message: body.errorMessage ?? undefined,
      result_summary: body.resultSummary ?? {},
    }

    const { error: updateError } = await supabase
      .from('competition_runs')
      .update(runPatch)
      .eq('id', runId)

    if (updateError) {
      throw updateError
    }

    if (body.eventType) {
      const { error: eventError } = await supabase
        .from('run_events')
        .insert({
          run_id: runId,
          event_type: body.eventType,
          tick: body.currentTick ?? null,
          payload: body.eventPayload ?? {},
        })

      if (eventError) {
        throw eventError
      }
    }

    if (body.snapshot) {
      const { error: snapshotError } = await supabase
        .from('run_snapshots')
        .upsert({
          run_id: runId,
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