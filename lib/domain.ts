export type Difficulty = 'NORMAL' | 'HARD' | 'HELL' | 'NIGHTMARE' | 'INFERNO'

export type AgentStatus = 'active' | 'inactive' | 'training' | 'error'

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout'

export type RankingTrend = 'up' | 'down' | 'stable'

export interface Agent {
  id: string
  name: string
  version: string
  owner: string
  created_at: string
  last_active: string
  total_runs: number
  win_rate: number
  avg_score: number
  status: AgentStatus
  avatar?: string
}

export interface Resources {
  gold: number
  mana: number
  lives: number
  max_lives: number
  energy: number
  max_energy: number
}

export interface Run {
  run_id: string
  agent_id: string
  agent_name: string
  difficulty: Difficulty
  seed: number
  status: RunStatus
  start_time: string
  end_time?: string
  duration_ms?: number
  current_tick: number
  max_ticks: number
  score: number
  wave: number
  max_wave: number
  resources: Resources
  towers_built: number
  enemies_killed: number
  damage_dealt: number
  damage_taken: number
  is_live: boolean
}

export interface SeasonRanking {
  rank: number
  agent_id: string
  agent_name: string
  owner: string
  score: number
  wins: number
  losses: number
  win_rate: number
  avg_duration_ms: number
  highest_wave: number
  difficulty_cleared: string[]
  last_match: string
  trend: RankingTrend
  rank_change: number
}

export interface DifficultyProgress {
  difficulty: Difficulty
  unlocked: boolean
  cleared: boolean
  best_score: number
  best_wave: number
  attempts: number
  clear_rate: number
  requirements: string[]
}

export interface EnqueueRunPayload {
  agentId: string
  difficulty: Difficulty
  seed?: number
  maxTicks?: number
  seasonCode?: string
}

export interface EnqueueRunResult {
  runId: string
  runCode: string
  status: RunStatus
}