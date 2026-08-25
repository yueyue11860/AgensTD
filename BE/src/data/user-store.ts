import type { UserProgress, PlayerType, Level5LeaderboardEntry } from '../domain/progress'
import type { AppUser } from '../domain/user'

/** 用户与关卡进度的持久化边界，可由 PostgreSQL 替换 Supabase 实现。 */
export interface UserStore {
  isEnabled(): boolean
  upsertUser(user: AppUser): Promise<void>
  getOrCreateProgress(playerId: string, playerType: PlayerType): Promise<UserProgress>
  recordLevelClear(
    playerId: string,
    level: number,
    playerType: PlayerType,
    maxStandardLevel: number,
  ): Promise<UserProgress>
  getLevel5Leaderboard(): Promise<Level5LeaderboardEntry[]>
}
