import type { Database } from './database.types.ts'
import type { ReportRunProgressPayload } from '../domain.ts'
import { getSupabaseAdminClient } from './admin.ts'
import { getSupabaseRunnerInvokeEnv } from './env.ts'

export type CompetitionRunRow = Database['public']['Tables']['competition_runs']['Row']

export interface FetchQueuedRunOptions {
  runId?: string
}

export async function fetchQueuedRun(options: FetchQueuedRunOptions = {}) {
  const client = getSupabaseAdminClient()

  if (!client) {
    throw new Error('Missing Supabase service environment')
  }

  let query = client
    .from('competition_runs')
    .select('*')
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: true })
    .limit(1)

  if (options.runId) {
    query = client
      .from('competition_runs')
      .select('*')
      .eq('id', options.runId)
      .limit(1)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data?.[0] ?? null) as CompetitionRunRow | null
}

export async function reportRunProgress(payload: ReportRunProgressPayload) {
  const env = getSupabaseRunnerInvokeEnv()

  if (!env) {
    throw new Error('Missing Supabase runner invoke environment')
  }

  const response = await fetch(`${env.url}/functions/v1/report-run-progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.anonKey,
      Authorization: `Bearer ${env.anonKey}`,
      'x-runner-secret': env.runnerSecret,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`report-run-progress failed: ${response.status} ${message}`)
  }

  return response.json()
}