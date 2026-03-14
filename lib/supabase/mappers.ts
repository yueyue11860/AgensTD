import type { Agent, Difficulty, DifficultyProgress, Resources, Run, SeasonRanking } from '@/lib/domain'
import type { Database, Json } from '@/lib/supabase/database.types'

const difficultyOrder: Difficulty[] = ['NORMAL', 'HARD', 'HELL', 'NIGHTMARE', 'INFERNO']

const difficultyRequirements: Record<Difficulty, string[]> = {
  NORMAL: [],
  HARD: ['通关 NORMAL'],
  HELL: ['通关 HARD', 'Win rate > 50%'],
  NIGHTMARE: ['通关 HELL', 'Total score > 500k'],
  INFERNO: ['通关 NIGHTMARE', 'Season Top 10'],
}

function asResources(value: Json): Resources {
  const source = typeof value === 'object' && value && !Array.isArray(value) ? value : {}

  return {
    gold: Number(source.gold ?? 0),
    mana: Number(source.mana ?? 0),
    lives: Number(source.lives ?? 0),
    max_lives: Number(source.max_lives ?? 0),
    energy: Number(source.energy ?? 0),
    max_energy: Number(source.max_energy ?? 0),
  }
}

export function mapAgentOverviewRow(row: Database['public']['Views']['agent_overview']['Row']): Agent {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    owner: row.owner,
    created_at: row.created_at,
    last_active: row.last_active,
    total_runs: Number(row.total_runs ?? 0),
    win_rate: Number(row.win_rate ?? 0),
    avg_score: Number(row.avg_score ?? 0),
    status: row.status,
    avatar: row.avatar ?? undefined,
  }
}

export function mapReplayLibraryRow(row: Database['public']['Views']['replay_library']['Row']): Run {
  return {
    run_id: row.run_id,
    agent_id: row.agent_id,
    agent_name: row.agent_name,
    difficulty: row.difficulty,
    seed: Number(row.seed),
    status: row.status,
    start_time: row.start_time,
    end_time: row.end_time ?? undefined,
    duration_ms: row.duration_ms ?? undefined,
    current_tick: Number(row.current_tick ?? 0),
    max_ticks: Number(row.max_ticks ?? 0),
    score: Number(row.score ?? 0),
    wave: Number(row.wave ?? 0),
    max_wave: Number(row.max_wave ?? 0),
    resources: asResources(row.resources),
    towers_built: Number(row.towers_built ?? 0),
    enemies_killed: Number(row.enemies_killed ?? 0),
    damage_dealt: Number(row.damage_dealt ?? 0),
    damage_taken: Number(row.damage_taken ?? 0),
    is_live: Boolean(row.is_live),
  }
}

export function mapSeasonRankingRow(row: Database['public']['Views']['season_rankings']['Row']): SeasonRanking {
  return {
    rank: Number(row.rank ?? 0),
    agent_id: row.agent_id,
    agent_name: row.agent_name,
    owner: row.owner,
    score: Number(row.score ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    win_rate: Number(row.win_rate ?? 0),
    avg_duration_ms: Number(row.avg_duration_ms ?? 0),
    highest_wave: Number(row.highest_wave ?? 0),
    difficulty_cleared: row.difficulty_cleared ?? [],
    last_match: row.last_match ?? new Date(0).toISOString(),
    trend: row.trend,
    rank_change: Number(row.rank_change ?? 0),
  }
}

export function mapDifficultyProgressRows(
  rows: Database['public']['Views']['agent_difficulty_progress']['Row'][],
): DifficultyProgress[] {
  const byDifficulty = new Map(rows.map((row) => [row.difficulty, row]))

  return difficultyOrder.map((difficulty, index) => {
    const row = byDifficulty.get(difficulty)
    const previousDifficulty = difficultyOrder[index - 1]
    const previousCleared = previousDifficulty ? Boolean(byDifficulty.get(previousDifficulty)?.cleared) : true

    return {
      difficulty,
      unlocked: index === 0 ? true : previousCleared,
      cleared: Boolean(row?.cleared),
      best_score: Number(row?.best_score ?? 0),
      best_wave: Number(row?.best_wave ?? 0),
      attempts: Number(row?.attempts ?? 0),
      clear_rate: Number(row?.clear_rate ?? 0),
      requirements: difficultyRequirements[difficulty],
    }
  })
}