import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from '../config/server-config'
import type { UserProgress, PlayerType } from '../domain/progress'

export class SupabaseUserStore {
  private readonly client: SupabaseClient | null

  constructor(config: ServerConfig) {
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    } else {
      this.client = null
    }
  }

  isEnabled(): boolean {
    return this.client !== null
  }

  /** 查询用户进度，不存在则创建默认记录 */
  async getOrCreateProgress(playerId: string, playerType: PlayerType): Promise<UserProgress> {
    if (!this.client) {
      return { playerId, playerType, highestUnlockedLevel: 1, level5ClearCount: 0 }
    }

    const { data, error } = await this.client
      .from('user_progress')
      .select('*')
      .eq('player_id', playerId)
      .maybeSingle()

    if (error) {
      console.error('getOrCreateProgress select failed:', error.message)
      return { playerId, playerType, highestUnlockedLevel: 1, level5ClearCount: 0 }
    }

    if (data) {
      return {
        playerId: data.player_id,
        playerType: data.player_type as PlayerType,
        highestUnlockedLevel: data.highest_unlocked_level,
        level5ClearCount: data.level5_clear_count,
      }
    }

    // 不存在 → 插入默认记录
    const { error: insertError } = await this.client
      .from('user_progress')
      .insert({
        player_id: playerId,
        player_type: playerType,
        highest_unlocked_level: 1,
        level5_clear_count: 0,
      })

    if (insertError) {
      console.error('getOrCreateProgress insert failed:', insertError.message)
    }

    return { playerId, playerType, highestUnlockedLevel: 1, level5ClearCount: 0 }
  }

  /** 记录关卡通关，更新进度 */
  async recordLevelClear(
    playerId: string,
    level: number,
    playerType: PlayerType,
    maxStandardLevel: number,
  ): Promise<UserProgress> {
    const progress = await this.getOrCreateProgress(playerId, playerType)

    const nextLevel = level + 1
    if (nextLevel > progress.highestUnlockedLevel && level <= maxStandardLevel) {
      progress.highestUnlockedLevel = nextLevel
    }

    if (level === maxStandardLevel) {
      progress.level5ClearCount++
    }

    if (!this.client) return progress

    const { error } = await this.client
      .from('user_progress')
      .update({
        highest_unlocked_level: progress.highestUnlockedLevel,
        level5_clear_count: progress.level5ClearCount,
        updated_at: new Date().toISOString(),
      })
      .eq('player_id', playerId)

    if (error) {
      console.error('recordLevelClear update failed:', error.message)
    }

    return progress
  }

  /** Level 5 排行榜 */
  async getLevel5Leaderboard(): Promise<
    Array<{ rank: number; playerId: string; playerType: '硅基' | '碳基'; clearCount: number }>
  > {
    if (!this.client) return []

    const { data, error } = await this.client
      .from('user_progress')
      .select('player_id, player_type, level5_clear_count')
      .gt('level5_clear_count', 0)
      .order('level5_clear_count', { ascending: false })
      .limit(100)

    if (error || !data) {
      console.error('getLevel5Leaderboard failed:', error?.message)
      return []
    }

    return data.map((row, index) => ({
      rank: index + 1,
      playerId: row.player_id,
      playerType: (row.player_type === 'AGENT' ? '硅基' : '碳基') as '硅基' | '碳基',
      clearCount: row.level5_clear_count,
    }))
  }
}
