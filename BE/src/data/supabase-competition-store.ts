import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config/server-config'
import type { DualLeaderboard, LeaderboardEntry, MatchResultRecord, ReplaySummary } from '../domain/competition'
import type { MatchReplay } from '../domain/replay'

interface MatchReplayRow {
  match_id: string
  created_at: string
  updated_at: string
  latest_tick: number
  frame_count: number
  action_count: number
  player_count: number
  top_wave: number
  top_score: number
  replay_json: MatchReplay
}

interface MatchResultRow {
  match_id: string
  player_id: string
  player_name: string
  player_kind: 'human' | 'agent'
  survived_waves: number
  score: number
  fortress: number
  updated_at: string
}

interface LeaderboardRow {
  player_id: string
  player_name: string
  player_kind: 'human' | 'agent'
  best_survived_waves: number
  best_score: number
  last_match_id: string
  updated_at: string
}

interface SupabaseErrorLike {
  message: string
  details?: string | null
  hint?: string | null
  code?: string
}

function summarizeSupabaseErrorText(value: string) {
  const normalized = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 240
    ? `${normalized.slice(0, 240)}...`
    : normalized
}

function throwIfSupabaseError(operation: string, error: SupabaseErrorLike | null) {
  if (!error) {
    return
  }

  const details = [error.message, error.details, error.hint, error.code]
    .filter((value): value is string => Boolean(value))
    .map((value) => summarizeSupabaseErrorText(value))
    .join(' | ')

  throw new Error(`Supabase ${operation} failed: ${details}`)
}

function mapReplaySummary(row: MatchReplayRow): ReplaySummary {
  return {
    matchId: row.match_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestTick: row.latest_tick,
    frameCount: row.frame_count,
    actionCount: row.action_count,
    playerCount: row.player_count,
    topWave: row.top_wave,
    topScore: row.top_score,
  }
}

function mapLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    playerId: row.player_id,
    playerName: row.player_name,
    playerKind: row.player_kind,
    bestSurvivedWaves: row.best_survived_waves,
    bestScore: row.best_score,
    lastMatchId: row.last_match_id,
    updatedAt: row.updated_at,
  }
}

function isBetterResult(next: MatchResultRecord, current: LeaderboardRow | null) {
  if (!current) {
    return true
  }

  if (next.score !== current.best_score) {
    return next.score > current.best_score
  }

  return next.survivedWaves > current.best_survived_waves
}

export class SupabaseCompetitionStore {
  private readonly client: SupabaseClient | null

  private remoteDisabledUntil = 0

  private readonly failureCooldownMs = 60_000

  private readonly requestTimeoutMs = 5_000

  constructor(config: ServerConfig) {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      this.client = null
      return
    }

    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }

  isEnabled() {
    return this.client !== null
  }

  async upsertReplay(replay: MatchReplay, summary: ReplaySummary) {
    if (!this.client || this.isRemoteTemporarilyDisabled()) {
      return
    }

    const client = this.client

    try {
      const { error } = await this.withRequestTimeout(() => client
        .from('match_replays')
        .upsert({
          match_id: summary.matchId,
          created_at: summary.createdAt,
          updated_at: summary.updatedAt,
          latest_tick: summary.latestTick,
          frame_count: summary.frameCount,
          action_count: summary.actionCount,
          player_count: summary.playerCount,
          top_wave: summary.topWave,
          top_score: summary.topScore,
          replay_json: replay,
        }, {
          onConflict: 'match_id',
        }))

      throwIfSupabaseError('upsertReplay', error)
      this.markRemoteSuccess()
    }
    catch (error) {
      this.markRemoteFailure()
      throw error
    }
  }

  async persistMatchResults(results: MatchResultRecord[]) {
    if (!this.client || results.length === 0 || this.isRemoteTemporarilyDisabled()) {
      return
    }

    const client = this.client

    const resultRows: MatchResultRow[] = results.map((result) => ({
      match_id: result.matchId,
      player_id: result.playerId,
      player_name: result.playerName,
      player_kind: result.playerKind,
      survived_waves: result.survivedWaves,
      score: result.score,
      fortress: result.fortress,
      updated_at: result.updatedAt,
    }))

    try {
      const { error: matchResultsError } = await this.withRequestTimeout(() => client
        .from('match_results')
        .upsert(resultRows, {
          onConflict: 'match_id,player_id',
        }))

      throwIfSupabaseError('persistMatchResults.match_results', matchResultsError)

      for (const result of results) {
        const { data: current, error: currentLeaderboardError } = await this.withRequestTimeout(() => client
          .from('leaderboard_entries')
          .select('player_id, player_name, player_kind, best_survived_waves, best_score, last_match_id, updated_at')
          .eq('player_id', result.playerId)
          .eq('player_kind', result.playerKind)
          .maybeSingle<LeaderboardRow>())

        throwIfSupabaseError('persistMatchResults.selectLeaderboardEntry', currentLeaderboardError)

        if (!isBetterResult(result, current)) {
          continue
        }

        const { error: leaderboardUpsertError } = await this.withRequestTimeout(() => client
          .from('leaderboard_entries')
          .upsert({
            player_id: result.playerId,
            player_name: result.playerName,
            player_kind: result.playerKind,
            best_survived_waves: result.survivedWaves,
            best_score: result.score,
            last_match_id: result.matchId,
            updated_at: result.updatedAt,
          }, {
            onConflict: 'player_id,player_kind',
          }))

        throwIfSupabaseError('persistMatchResults.upsertLeaderboardEntry', leaderboardUpsertError)
      }

      this.markRemoteSuccess()
    }
    catch (error) {
      this.markRemoteFailure()
      throw error
    }
  }

  async listRecentReplays(limit: number) {
    if (!this.client || this.isRemoteTemporarilyDisabled()) {
      return [] satisfies ReplaySummary[]
    }

    const client = this.client

    try {
      const { data, error } = await this.withRequestTimeout(() => client
        .from('match_replays')
        .select('match_id, created_at, updated_at, latest_tick, frame_count, action_count, player_count, top_wave, top_score, replay_json')
        .order('updated_at', { ascending: false })
        .limit(limit))

      throwIfSupabaseError('listRecentReplays', error)
      this.markRemoteSuccess()

      return (data ?? []).map((row) => mapReplaySummary(row as MatchReplayRow))
    }
    catch (error) {
      this.markRemoteFailure()
      throw error
    }
  }

  async getReplay(matchId: string) {
    if (!this.client || this.isRemoteTemporarilyDisabled()) {
      return null
    }

    const client = this.client

    try {
      const { data, error } = await this.withRequestTimeout(() => client
        .from('match_replays')
        .select('replay_json')
        .eq('match_id', matchId)
        .maybeSingle<{ replay_json: MatchReplay }>())

      throwIfSupabaseError('getReplay', error)
      this.markRemoteSuccess()

      return data?.replay_json ?? null
    }
    catch (error) {
      this.markRemoteFailure()
      throw error
    }
  }

  async getDualLeaderboards(limit: number): Promise<DualLeaderboard> {
    if (!this.client || this.isRemoteTemporarilyDisabled()) {
      return {
        human: [],
        agent: [],
        all: [],
      }
    }

    return {
      human: await this.getLeaderboardByKind('human', limit),
      agent: await this.getLeaderboardByKind('agent', limit),
      all: await this.getLeaderboardByKind('all', limit),
    }
  }

  private async getLeaderboardByKind(kind: 'human' | 'agent' | 'all', limit: number) {
    if (!this.client || this.isRemoteTemporarilyDisabled()) {
      return [] satisfies LeaderboardEntry[]
    }

    let query = this.client
      .from('leaderboard_entries')
      .select('player_id, player_name, player_kind, best_survived_waves, best_score, last_match_id, updated_at')
      .order('best_score', { ascending: false })
      .order('best_survived_waves', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (kind !== 'all') {
      query = query.eq('player_kind', kind)
    }

    try {
      const { data, error } = await this.withRequestTimeout(() => query)
      throwIfSupabaseError(`getLeaderboardByKind.${kind}`, error)
      this.markRemoteSuccess()
      return (data ?? []).map((row) => mapLeaderboardEntry(row as LeaderboardRow))
    }
    catch (error) {
      this.markRemoteFailure()
      throw error
    }
  }

  private isRemoteTemporarilyDisabled() {
    return Date.now() < this.remoteDisabledUntil
  }

  private markRemoteFailure() {
    this.remoteDisabledUntil = Date.now() + this.failureCooldownMs
  }

  private markRemoteSuccess() {
    this.remoteDisabledUntil = 0
  }

  private async withRequestTimeout<T>(requestFactory: () => PromiseLike<T>) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    try {
      return await Promise.race([
        Promise.resolve(requestFactory()),
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Supabase request timed out after ${this.requestTimeoutMs}ms`))
          }, this.requestTimeoutMs)
        }),
      ])
    }
    finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }
}