/**
 * 难度阶梯与通关记录 — 领域类型定义
 *
 * PlayerType: 'HUMAN' (碳基) | 'AGENT' (硅基)
 *
 * 关卡规则：
 *  - Level 0  : 教学关，仅限 HUMAN
 *  - Level 1-5: 标准关卡，均可游玩
 *  - Level 6  : 隐藏关，Level 5 通关 5 次后解锁
 *  - 必须通关上一级才能解锁下一级
 */

export type PlayerType = 'HUMAN' | 'AGENT'

/** 教学关 ID（仅 HUMAN 可用） */
export const TUTORIAL_LEVEL_ID = 0

/** 最高标准关卡 ID */
export const MAX_STANDARD_LEVEL = 5

/** 隐藏关卡 ID */
export const HIDDEN_LEVEL_ID = 6

/** 解锁隐藏关所需的 Level 5 通关次数 */
export const HIDDEN_LEVEL_UNLOCK_COUNT = 5

// ──────────────────────────────────────────────────────────────────────────────
// 核心模型
// ──────────────────────────────────────────────────────────────────────────────

export interface UserProgress {
  /** 玩家唯一 ID */
  playerId: string
  /** 玩家类型：碳基 | 硅基 */
  playerType: PlayerType
  /**
   * 已解锁的最高关卡 ID（默认 1）。
   * 解锁含义：该关卡对应的"开始游戏"按钮可以被点击。
   */
  highestUnlockedLevel: number
  /** Level 5 累计通关次数（默认 0），用于排行榜与隐藏关解锁 */
  level5ClearCount: number
}

// ──────────────────────────────────────────────────────────────────────────────
// 录像提交载荷
// ──────────────────────────────────────────────────────────────────────────────

export interface ReplaySubmissionPayload {
  /** 是否胜利。false 时后端直接丢弃，不占用存储。 */
  isVictory: boolean
  /** 本场使用的关卡 ID */
  level: number
  /** 玩家类型（由调用方在认证信息中携带，也可显式传入） */
  playerType?: PlayerType
  /** 可选：完整录像数据 */
  replayData?: unknown
}

// ──────────────────────────────────────────────────────────────────────────────
// 解锁检查结果
// ──────────────────────────────────────────────────────────────────────────────

export type UnlockCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string }

// ──────────────────────────────────────────────────────────────────────────────
// 排行榜条目
// ──────────────────────────────────────────────────────────────────────────────

export interface Level5LeaderboardEntry {
  /** 排名（1 起步） */
  rank: number
  playerId: string
  /** 展示用文字：硅基 / 碳基 */
  playerType: '硅基' | '碳基'
  /** Level 5 累计通关次数 */
  clearCount: number
}
