import type { UserProgress, PlayerType, Level5LeaderboardEntry } from '../domain/progress'
import { MAX_STANDARD_LEVEL } from '../domain/progress'

/**
 * ProgressStore — 内存 Mock 实现
 *
 * 生产部署时可直接换成 Supabase / Prisma 等持久化方案，
 * 只需实现相同的公开方法签名即可。
 */
export class ProgressStore {
  private readonly store = new Map<string, UserProgress>()

  // ──────────────────────────────────────────────────────────────────────────
  // 基础 CRUD
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 查询玩家进度；若不存在则按默认值创建并返回。
   */
  getOrCreate(playerId: string, playerType: PlayerType): UserProgress {
    const existing = this.store.get(playerId)
    if (existing) {
      return existing
    }

    const fresh: UserProgress = {
      playerId,
      playerType,
      highestUnlockedLevel: 1,
      level5ClearCount: 0,
    }

    this.store.set(playerId, fresh)
    return fresh
  }

  /**
   * 仅查询，不创建。
   */
  getProgress(playerId: string): UserProgress | undefined {
    return this.store.get(playerId)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 通关记录
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 记录一次关卡通关（isVictory 已由调用方过滤，此处直接写入）。
   *
   * - 如果 level+1 > highestUnlockedLevel，则更新 highestUnlockedLevel
   * - 如果通关关卡是 Level 5，则 level5ClearCount++
   */
  recordLevelClear(playerId: string, level: number, playerType: PlayerType): UserProgress {
    const progress = this.getOrCreate(playerId, playerType)

    // 下一关解锁（上限为隐藏关前的最后一关，隐藏关由 unlock-logic 单独控制）
    const nextLevel = level + 1
    if (nextLevel > progress.highestUnlockedLevel && level <= MAX_STANDARD_LEVEL) {
      progress.highestUnlockedLevel = nextLevel
    }

    // 累计 Level 5 通关次数
    if (level === MAX_STANDARD_LEVEL) {
      progress.level5ClearCount++
    }

    return progress
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 排行榜查询
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 返回 Level 5 通关次数 > 0 的玩家，按 clearCount 降序。
   */
  getLevel5Leaderboard(): Level5LeaderboardEntry[] {
    return Array.from(this.store.values())
      .filter(p => p.level5ClearCount > 0)
      .sort((a, b) => b.level5ClearCount - a.level5ClearCount)
      .map((p, index) => ({
        rank: index + 1,
        playerId: p.playerId,
        playerType: (p.playerType === 'AGENT' ? '硅基' : '碳基') as '硅基' | '碳基',
        clearCount: p.level5ClearCount,
      }))
  }
}
