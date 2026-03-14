import { createClient } from 'jsr:@supabase/supabase-js@2'
import { parseEnqueuePayload } from '../_shared/run-contract.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const payload = parseEnqueuePayload(await req.json())

    const rpcPayload = {
      p_agent_id: payload.agentId,
      p_difficulty: payload.difficulty,
      ...(payload.seed !== undefined ? { p_seed: payload.seed } : {}),
      ...(payload.maxTicks !== undefined ? { p_max_ticks: payload.maxTicks } : {}),
      ...(payload.seasonCode !== undefined ? { p_season_code: payload.seasonCode } : {}),
    }

    const { data, error } = await supabase.rpc('enqueue_run', rpcPayload)

    if (error) {
      throw error
    }

    return Response.json(
      {
        runId: data.id,
        runCode: data.run_code,
        status: data.status,
      },
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  }
})