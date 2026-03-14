import type {
  AgentStatus,
  CoreReplaySnapshot,
  Difficulty,
  GameAction,
  RankingTrend,
  Resources,
  RunEventPayload,
  RunEventType,
  RunResultSummary,
  RunStatus,
} from '@/lib/domain'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string
          slug: string
          name: string
          owner_user_id: string | null
          owner_name: string
          latest_version: string
          status: AgentStatus
          avatar_url: string | null
          visibility: 'public' | 'private' | 'unlisted'
          metadata: Json
          created_at: string
          updated_at: string
          last_active_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          owner_user_id?: string | null
          owner_name: string
          latest_version?: string
          status?: AgentStatus
          avatar_url?: string | null
          visibility?: 'public' | 'private' | 'unlisted'
          metadata?: Json
          created_at?: string
          updated_at?: string
          last_active_at?: string
        }
        Update: Partial<Database['public']['Tables']['agents']['Insert']>
        Relationships: []
      }
      seasons: {
        Row: {
          id: string
          code: string
          name: string
          status: 'upcoming' | 'active' | 'archived'
          starts_at: string
          ends_at: string
          rules: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          status?: 'upcoming' | 'active' | 'archived'
          starts_at: string
          ends_at: string
          rules?: Json
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['seasons']['Insert']>
        Relationships: []
      }
      competition_runs: {
        Row: {
          id: string
          run_code: string
          agent_id: string
          season_id: string | null
          triggered_by: string | null
          difficulty: Difficulty
          seed: number
          status: RunStatus
          start_time: string | null
          end_time: string | null
          duration_ms: number | null
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
          replay_public: boolean
          view_count: number
          thumbnail_url: string | null
          error_message: string | null
          result_summary: RunResultSummary
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          run_code?: string
          agent_id: string
          season_id?: string | null
          triggered_by?: string | null
          difficulty: Difficulty
          seed: number
          status?: RunStatus
          start_time?: string | null
          end_time?: string | null
          duration_ms?: number | null
          current_tick?: number
          max_ticks?: number
          score?: number
          wave?: number
          max_wave?: number
          resources?: Resources
          towers_built?: number
          enemies_killed?: number
          damage_dealt?: number
          damage_taken?: number
          is_live?: boolean
          replay_public?: boolean
          view_count?: number
          thumbnail_url?: string | null
          error_message?: string | null
          result_summary?: RunResultSummary
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['competition_runs']['Insert']>
        Relationships: []
      }
      run_events: {
        Row: {
          id: number
          run_id: string
          event_type: RunEventType
          tick: number | null
          payload: RunEventPayload
          created_at: string
        }
        Insert: {
          id?: number
          run_id: string
          event_type: RunEventType
          tick?: number | null
          payload?: RunEventPayload
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['run_events']['Insert']>
        Relationships: []
      }
      run_actions: {
        Row: {
          id: number
          run_id: string
          tick: number
          action: GameAction
          accepted: boolean
          validation_code: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: number
          run_id: string
          tick?: number
          action: GameAction
          accepted?: boolean
          validation_code?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['run_actions']['Insert']>
        Relationships: []
      }
      run_snapshots: {
        Row: {
          id: number
          run_id: string
          tick: number
          snapshot: CoreReplaySnapshot
          created_at: string
        }
        Insert: {
          id?: number
          run_id: string
          tick: number
          snapshot: CoreReplaySnapshot
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['run_snapshots']['Insert']>
        Relationships: []
      }
    }
    Views: {
      agent_overview: {
        Row: {
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
          avatar: string | null
        }
      }
      replay_library: {
        Row: {
          run_id: string
          agent_id: string
          agent_name: string
          difficulty: Difficulty
          seed: number
          status: RunStatus
          start_time: string
          end_time: string | null
          duration_ms: number | null
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
          view_count: number
          thumbnail_url: string | null
        }
      }
      season_rankings: {
        Row: {
          season_code: string
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
          difficulty_cleared: string[] | null
          last_match: string | null
          trend: RankingTrend
          rank_change: number
        }
      }
      agent_difficulty_progress: {
        Row: {
          agent_id: string
          difficulty: Difficulty
          cleared: boolean
          best_score: number
          best_wave: number
          attempts: number
          clear_rate: number
        }
      }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}