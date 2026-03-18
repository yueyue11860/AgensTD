import type { UserProgress, PlayerType, Level5LeaderboardEntry } from '../domain/progress'
import { MAX_STANDARD_LEVEL } from '../domain/progress'
import type { SupabaseUserStore } from './supabase-user-store'

/**
 * ProgressStore — 内存 + Supabase 持久化
 *
 * 内存缓存用于高频读取，写入时同步持久化到 Supabase。
 */
export class ProgressStore {
  private readonly store = new Map<string, UserProgress>()
  private userStore: SupabaseUserStore | null = null

  /** 注入 Supabase 用户存储（在 server.ts 中调用） */
  setUserStore(userStore: SupabaseUserStore): void {
    this.userStore = userStore
  }

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

    // 异步持久化到 Supabase（不阻塞返回）
    if (this.userStore?.isEnabled()) {
      void this.userStore.recordLevelClear(playerId, level, playerType, MAX_STANDARD_LEVEL)
        .catch((err) => console.error('Supabase progress sync failed:', err))
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
    // 优先从 Supabase 获取（异步转同步：由调用方使用 async 版本）
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

  /** 异步版排行榜，优先使用 Supabase */
  async getLevel5LeaderboardAsync(): Promise<Level5LeaderboardEntry[]> {
    if (this.userStore?.isEnabled()) {
      try {
        return await this.userStore.getLevel5Leaderboard()
      } catch {
        // fallback to memory
      }
    }
    return this.getLevel5Leaderboard()
  }

  /** 从 Supabase 加载玩家进度到内存缓存 */
  async loadProgressFromDb(playerId: string, playerType: PlayerType): Promise<UserProgress> {
    if (this.userStore?.isEnabled()) {
      try {
        const progress = await this.userStore.getOrCreateProgress(playerId, playerType)
        this.store.set(playerId, progress)
        return progress
      } catch {
        // fallback
      }
    }
    return this.getOrCreate(playerId, playerType)
  }
}
