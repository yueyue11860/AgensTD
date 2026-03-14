import type { SupabaseClient } from '@supabase/supabase-js'
import type { Agent, DifficultyProgress, Run, SeasonRanking } from '@/lib/domain'
import { mapAgentOverviewRow, mapDifficultyProgressRows, mapReplayLibraryRow, mapSeasonRankingRow } from '@/lib/supabase/mappers'
import type { Database } from '@/lib/supabase/database.types'

export interface RepositoryResult<T> {
  data: T
  error: string | null
}

export async function fetchAgentOverview(client: SupabaseClient<Database>): Promise<RepositoryResult<Agent[]>> {
  const { data, error } = await client
    .from('agent_overview')
    .select('*')
    .order('last_active', { ascending: false })

  return {
    data: (data ?? []).map(mapAgentOverviewRow),
    error: error?.message ?? null,
  }
}

export async function fetchReplayLibrary(client: SupabaseClient<Database>): Promise<RepositoryResult<Run[]>> {
  const { data, error } = await client
    .from('replay_library')
    .select('*')
    .order('end_time', { ascending: false, nullsFirst: false })

  return {
    data: (data ?? []).map(mapReplayLibraryRow),
    error: error?.message ?? null,
  }
}

export async function fetchSeasonRankings(
  client: SupabaseClient<Database>,
  seasonCode: string,
): Promise<RepositoryResult<SeasonRanking[]>> {
  let query = client.from('season_rankings').select('*').order('rank', { ascending: true })

  if (seasonCode !== 'ALL') {
    query = query.eq('season_code', seasonCode)
  }

  const { data, error } = await query

  return {
    data: (data ?? []).map(mapSeasonRankingRow),
    error: error?.message ?? null,
  }
}

export async function fetchAgentDifficultyProgress(
  client: SupabaseClient<Database>,
  agentId: string,
): Promise<RepositoryResult<DifficultyProgress[]>> {
  const { data, error } = await client
    .from('agent_difficulty_progress')
    .select('*')
    .eq('agent_id', agentId)

  return {
    data: mapDifficultyProgressRows(data ?? []),
    error: error?.message ?? null,
  }
}