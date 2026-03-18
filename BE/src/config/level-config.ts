/**
 * level-config.ts — 难度阶梯关卡配置
 *
 * ┌──────┬──────────────────┬────────────┬────────────────────────────────────────────┐
 * │ 关卡 │ 名称             │ 目标通关率 │ 核心机制                                   │
 * ├──────┼──────────────────┼────────────┼────────────────────────────────────────────┤
 * │  L0  │ 新人引导场       │  教学 100% │ 极慢 Grunt，大量初始金币，仅碳基可用       │
 * │  L1  │ 基础心智试炼     │    ~50%    │ 基础 Grunt + 少量 Speedster 高移速施压     │
 * │  L2  │ 护甲机制引入     │    ~40%    │ 大量 Tank 混搭 Grunt，逼迫电塔破甲         │
 * │  L3  │ 虫群机制引入     │    ~30%    │ 极高密度 Swarm-Drone，逼迫范围清杂         │
 * │  L4  │ 复合精英压迫     │    ~20%    │ Shielded + Cleanser，考验单体爆发与布局     │
 * │  L5  │ 算力深渊         │    ~10%    │ Lord 系 + 虫群同屏，排行榜竞技关           │
 * │  L6  │ 零域裁决（隐藏） │     ~3%    │ 强制双人！单人 cap=10 必定 Overload 崩溃  │
 * └──────┴──────────────────┴────────────┴────────────────────────────────────────────┘
 *
 * 时间单位说明（tickRateMs 默认 100ms）：
 *   interval / delay / prepTime 均以 tick 为单位
 *   interval:1  = 每 100ms 刷一只 = 10只/秒
 *   interval:2  = 每 200ms 刷一只 = 5只/秒
 *   interval:10 = 每 1000ms 刷一只 = 1只/秒
 *   prepTime:30 = 3 秒准备时间
 *
 * maxEnemyCapacity（同屏上限）：
 *   GameEngine 使用 playerCount × 10 计算，此处仅作文档标注与前端展示用途。
 */

import type { WaveConfig } from '../../../shared/contracts/game'
import type { PlayerKind } from '../domain/game-state'

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface LevelConfig {
  /** 关卡编号（0 = 教学，6 = 隐藏关） */
  levelId: number
  /** 展示名称 */
  label: string
  /** 简短描述 */
  description: string
  /** 目标通关率，0-1，仅供 UI 展示 */
  targetClearRate: number
  /**
   * 允许进入的玩家类型。
   * Level 0 仅限 human；其余关卡不限。
   */
  allowedPlayerKinds: PlayerKind[]
  /**
   * 本关推荐初始金币（会覆盖 serverConfig.playerStartingGold）。
   * undefined = 使用服务端默认配置。
   */
  startingGold?: number
  /**
   * 推荐最低参与人数（前端展示与解锁提示用，不在引擎层强制）。
   * L6 = 2，其余 = 1。
   */
  minPlayers: number
  /**
   * 每位玩家贡献的同屏上限（GameEngine 实际用 playerCount × 10）。
   * 此处值 = 10，仅供 README 与前端锁屏提示。
   */
  capacityPerPlayer: 10
  /** 波次列表，供 WaveManager 直接消费 */
  waves: WaveConfig[]
}

// ─────────────────────────────────────────────────────────────────────────────
// L0 — 新人引导场（人类专属教学关）
// ─────────────────────────────────────────────────────────────────────────────
//  • 3 波，极慢 Grunt，无威胁
//  • 初始金币 800，让玩家自由摆塔熟悉机制
//  • prepTime 60 tick = 6 秒，充裕建造窗口
// ─────────────────────────────────────────────────────────────────────────────

const level0Waves: WaveConfig[] = [
  {
    waveNumber: 1,
    prepTime: 300,
    groups: [
      // 5 只 Grunt，每 2 秒 1 只，极度宽松
      { enemyType: 'Grunt', count: 5, interval: 20, delay: 0 },
    ],
  },
  {
    waveNumber: 2,
    prepTime: 300,
    groups: [
      // 8 只 Grunt，每 1 秒 1 只，初步体验节奏
      { enemyType: 'Grunt', count: 8, interval: 10, delay: 0 },
    ],
  },
  {
    waveNumber: 3,
    prepTime: 300,
    groups: [
      // 10 只 Grunt，每 0.8 秒 1 只，结尾小高潮
      { enemyType: 'Grunt', count: 10, interval: 8, delay: 0 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// L1 — 基础心智试炼（~50% 通关率）
// ─────────────────────────────────────────────────────────────────────────────
//  • 5 波，Grunt 为主 + 少量 Speedster（speed:2.5）
//  • 测试玩家能否用基础炮台覆盖高移速单位
// ─────────────────────────────────────────────────────────────────────────────

const level1Waves: WaveConfig[] = [
  {
    waveNumber: 1,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt', count: 8, interval: 5, delay: 0 },
    ],
  },
  {
    waveNumber: 2,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt',     count: 10, interval: 4, delay: 0 },
      { enemyType: 'Speedster', count: 3,  interval: 8, delay: 10 },
    ],
  },
  {
    waveNumber: 3,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt',     count: 12, interval: 3, delay: 0 },
      { enemyType: 'Speedster', count: 5,  interval: 5, delay: 5 },
    ],
  },
  {
    waveNumber: 4,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt',     count: 15, interval: 3, delay: 0 },
      { enemyType: 'Speedster', count: 8,  interval: 4, delay: 3 },
    ],
  },
  {
    waveNumber: 5,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt',     count: 18, interval: 3, delay: 0 },
      { enemyType: 'Speedster', count: 12, interval: 3, delay: 2 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// L2 — 护甲机制引入（~40% 通关率）
// ─────────────────────────────────────────────────────────────────────────────
//  • 8 波，Tank (armor:2) + Grunt，后期引入 Grunt-Armored (armor:8) / Tank-Fortress
//  • 压迫玩家升级或建造电塔（armor-break 效果）
// ─────────────────────────────────────────────────────────────────────────────

const level2Waves: WaveConfig[] = [
  {
    waveNumber: 1,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt', count: 10, interval: 4, delay: 0 },
    ],
  },
  {
    waveNumber: 2,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt', count: 12, interval: 3, delay: 0 },
      { enemyType: 'Tank',  count: 2,  interval: 20, delay: 5 },
    ],
  },
  {
    waveNumber: 3,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt', count: 14, interval: 3, delay: 0 },
      { enemyType: 'Tank',  count: 3,  interval: 15, delay: 0 },
    ],
  },
  {
    waveNumber: 4,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt', count: 12, interval: 3, delay: 0 },
      { enemyType: 'Tank',  count: 4,  interval: 12, delay: 0 },
      { enemyType: 'Speedster', count: 5, interval: 5, delay: 8 },
    ],
  },
  {
    waveNumber: 5,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt', count: 15, interval: 2, delay: 0 },
      { enemyType: 'Tank',  count: 5,  interval: 10, delay: 0 },
    ],
  },
  {
    waveNumber: 6,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt-Armored', count: 10, interval: 5, delay: 0 },
      { enemyType: 'Tank',          count: 6,  interval: 9, delay: 0 },
      { enemyType: 'Speedster',     count: 8,  interval: 3, delay: 3 },
    ],
  },
  {
    waveNumber: 7,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt-Armored', count: 15, interval: 4, delay: 0 },
      { enemyType: 'Tank',          count: 6,  interval: 8, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 2,  interval: 30, delay: 10 },
    ],
  },
  {
    waveNumber: 8,
    prepTime: 300,
    groups: [
      { enemyType: 'Grunt-Armored', count: 12, interval: 3, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 4,  interval: 20, delay: 0 },
      { enemyType: 'Tank',          count: 8,  interval: 7, delay: 5 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// L3 — 虫群机制引入（~30% 通关率）
// ─────────────────────────────────────────────────────────────────────────────
//  • 10 波，大量 Swarm-Drone (hp:15, speed:1.5) 密集刷出
//  • 逼迫玩家建造 AOE 炮塔/魔法塔处理群体；后期引入 Lord-01 考验高血量单体
//  • 关键压力点：wave 7 起 Swarm-Drone interval:1（10只/秒）
// ─────────────────────────────────────────────────────────────────────────────

const level3Waves: WaveConfig[] = [
  {
    waveNumber: 1,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone', count: 20, interval: 2, delay: 0 },
      { enemyType: 'Grunt',       count: 5,  interval: 6, delay: 5 },
    ],
  },
  {
    waveNumber: 2,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone', count: 30, interval: 2, delay: 0 },
      { enemyType: 'Speedster',   count: 5,  interval: 5, delay: 0 },
    ],
  },
  {
    waveNumber: 3,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone', count: 35, interval: 2, delay: 0 },
      { enemyType: 'Tank',        count: 3,  interval: 15, delay: 0 },
    ],
  },
  {
    waveNumber: 4,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone', count: 40, interval: 2, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 10, interval: 3, delay: 5 },
      { enemyType: 'Tank',         count: 4, interval: 12, delay: 0 },
    ],
  },
  {
    waveNumber: 5,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 50, interval: 2, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 15, interval: 2, delay: 0 },
      { enemyType: 'Tank',         count: 5,  interval: 10, delay: 3 },
    ],
  },
  {
    waveNumber: 6,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 60, interval: 1, delay: 0 },
      { enemyType: 'Grunt-Armored', count: 8,  interval: 8, delay: 0 },
      { enemyType: 'Swarm-Runner',  count: 15, interval: 3, delay: 2 },
    ],
  },
  {
    waveNumber: 7,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 70, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 20, interval: 2, delay: 0 },
      { enemyType: 'Tank',         count: 6,  interval: 9, delay: 3 },
    ],
  },
  {
    waveNumber: 8,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 80, interval: 1, delay: 0 },
      { enemyType: 'Grunt-Armored', count: 8,  interval: 6, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 3,  interval: 20, delay: 5 },
    ],
  },
  {
    waveNumber: 9,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 90, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner',  count: 25, interval: 2, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 4,  interval: 18, delay: 0 },
    ],
  },
  {
    waveNumber: 10,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 100, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner',  count: 30,  interval: 1, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 4,   interval: 15, delay: 5 },
      // 首领收尾：Lord-01 (hp:3000, shield:500, armor:5)
      { enemyType: 'Lord-01',       count: 1,   interval: 1,  delay: 80 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// L4 — 复合精英压迫（~20% 通关率）
// ─────────────────────────────────────────────────────────────────────────────
//  • 12 波，Shielded (hp:100+shield:80) + Cleanser (免控净化)
//  • Cleanser 每 3 秒清除 debuff，迫使玩家在净化间隙打爆护盾 → 单体爆发要求极高
//  • 后期引入 Cleanser-Pro（死亡分裂 3 只 Swarm-Drone）
//  • Wave 12 = Lord-02 终章 (hp:8000, shield:1000, armor:20)
// ─────────────────────────────────────────────────────────────────────────────

const level4Waves: WaveConfig[] = [
  {
    waveNumber: 1,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded', count: 6,  interval: 8, delay: 0 },
      { enemyType: 'Grunt',    count: 8,  interval: 4, delay: 0 },
    ],
  },
  {
    waveNumber: 2,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded', count: 8,  interval: 6, delay: 0 },
      { enemyType: 'Cleanser', count: 3,  interval: 20, delay: 0 },
    ],
  },
  {
    waveNumber: 3,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded', count: 10, interval: 5, delay: 0 },
      { enemyType: 'Cleanser', count: 5,  interval: 15, delay: 0 },
      { enemyType: 'Grunt',    count: 10, interval: 3, delay: 2 },
    ],
  },
  {
    waveNumber: 4,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded', count: 12, interval: 5, delay: 0 },
      { enemyType: 'Cleanser', count: 6,  interval: 12, delay: 0 },
      { enemyType: 'Speedster', count: 8, interval: 3, delay: 5 },
    ],
  },
  {
    waveNumber: 5,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded', count: 14, interval: 4, delay: 0 },
      { enemyType: 'Cleanser', count: 6,  interval: 10, delay: 0 },
      { enemyType: 'Tank',     count: 5,  interval: 14, delay: 3 },
    ],
  },
  {
    waveNumber: 6,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded', count: 15, interval: 4, delay: 0 },
      { enemyType: 'Cleanser', count: 8,  interval: 9, delay: 0 },
      { enemyType: 'Speedster', count: 10, interval: 3, delay: 2 },
    ],
  },
  {
    waveNumber: 7,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded',      count: 18, interval: 3, delay: 0 },
      { enemyType: 'Cleanser',      count: 8,  interval: 8, delay: 0 },
      { enemyType: 'Tank',          count: 6,  interval: 12, delay: 3 },
      { enemyType: 'Swarm-Drone',   count: 20, interval: 2, delay: 0 },
    ],
  },
  {
    waveNumber: 8,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded',      count: 20, interval: 3, delay: 0 },
      { enemyType: 'Cleanser',      count: 10, interval: 7, delay: 0 },
      { enemyType: 'Grunt-Armored', count: 10, interval: 5, delay: 0 },
    ],
  },
  {
    waveNumber: 9,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded',      count: 22, interval: 3, delay: 0 },
      { enemyType: 'Cleanser',      count: 10, interval: 7, delay: 0 },
      // 净化者 Pro：死亡后分裂 3 只 Swarm-Drone
      { enemyType: 'Cleanser-Pro',  count: 3,  interval: 25, delay: 5 },
    ],
  },
  {
    waveNumber: 10,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded',     count: 25, interval: 3, delay: 0 },
      { enemyType: 'Cleanser',     count: 12, interval: 6, delay: 0 },
      { enemyType: 'Cleanser-Pro', count: 5,  interval: 18, delay: 0 },
    ],
  },
  {
    waveNumber: 11,
    prepTime: 300,
    groups: [
      { enemyType: 'Shielded',      count: 20, interval: 2, delay: 0 },
      { enemyType: 'Cleanser-Pro',  count: 10, interval: 10, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 4,  interval: 22, delay: 5 },
    ],
  },
  {
    waveNumber: 12,
    prepTime: 300,
    groups: [
      // ── 终章 ──────────────────────────────────────────────────────────────
      // Lord-02 (hp:8000, shield:1000, armor:20)
      { enemyType: 'Lord-02',      count: 1,  interval: 1,  delay: 0  },
      // 后续护卫波
      { enemyType: 'Shielded',     count: 25, interval: 2,  delay: 20 },
      { enemyType: 'Cleanser-Pro', count: 8,  interval: 10, delay: 30 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// L5 — 算力深渊（~10% 通关率）排行榜竞技关
// ─────────────────────────────────────────────────────────────────────────────
//  • 15 波，全类型怪物混搭
//  • Wave 8: Lord-01 首次登场
//  • Wave 13: Lord-02 中场
//  • Wave 15: Lord-03 (hp:12000, armor:10) + 满屏虫群终章
//  • 整体 DPS 要求约为 L4 的 2 倍
// ─────────────────────────────────────────────────────────────────────────────

const level5Waves: WaveConfig[] = [
  {
    waveNumber: 1,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone', count: 30, interval: 2, delay: 0 },
      { enemyType: 'Grunt',       count: 10, interval: 4, delay: 0 },
    ],
  },
  {
    waveNumber: 2,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 50, interval: 1, delay: 0 },
      { enemyType: 'Speedster',    count: 8,  interval: 3, delay: 0 },
    ],
  },
  {
    waveNumber: 3,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 60, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 10, interval: 2, delay: 0 },
      { enemyType: 'Tank',         count: 8,  interval: 10, delay: 0 },
    ],
  },
  {
    waveNumber: 4,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 70, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 15, interval: 2, delay: 0 },
      { enemyType: 'Tank',         count: 8,  interval: 8, delay: 0 },
    ],
  },
  {
    waveNumber: 5,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 60, interval: 1, delay: 0 },
      { enemyType: 'Shielded',     count: 10, interval: 6, delay: 0 },
      { enemyType: 'Cleanser',     count: 5,  interval: 12, delay: 3 },
    ],
  },
  {
    waveNumber: 6,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 80, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner',  count: 20, interval: 2, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 5,  interval: 18, delay: 0 },
    ],
  },
  {
    waveNumber: 7,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 80, interval: 1, delay: 0 },
      { enemyType: 'Shielded',     count: 12, interval: 5, delay: 0 },
      { enemyType: 'Cleanser',     count: 8,  interval: 9, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 20, interval: 2, delay: 2 },
    ],
  },
  {
    waveNumber: 8,
    prepTime: 300,
    groups: [
      // ── Lord-01 首次现身 ─────────────────────────────────────────────────
      { enemyType: 'Lord-01',      count: 1,  interval: 1,  delay: 0  },
      { enemyType: 'Swarm-Drone',  count: 80, interval: 1,  delay: 10 },
      { enemyType: 'Swarm-Runner', count: 20, interval: 2,  delay: 5  },
    ],
  },
  {
    waveNumber: 9,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 100, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 25,  interval: 2, delay: 0 },
      { enemyType: 'Shielded',     count: 12,  interval: 5, delay: 0 },
    ],
  },
  {
    waveNumber: 10,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 100, interval: 1, delay: 0 },
      { enemyType: 'Cleanser-Pro',  count: 10,  interval: 8, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 6,   interval: 15, delay: 0 },
    ],
  },
  {
    waveNumber: 11,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',  count: 120, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner', count: 30,  interval: 1, delay: 0 },
      { enemyType: 'Cleanser-Pro', count: 10,  interval: 7, delay: 0 },
    ],
  },
  {
    waveNumber: 12,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 100, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner',  count: 25,  interval: 1, delay: 0 },
      { enemyType: 'Shielded',      count: 12,  interval: 4, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 5,   interval: 14, delay: 0 },
    ],
  },
  {
    waveNumber: 13,
    prepTime: 300,
    groups: [
      // ── Lord-02 中场决战 ─────────────────────────────────────────────────
      { enemyType: 'Lord-02',      count: 1,   interval: 1, delay: 0  },
      { enemyType: 'Swarm-Drone',  count: 120, interval: 1, delay: 15 },
      { enemyType: 'Cleanser-Pro', count: 12,  interval: 6, delay: 20 },
    ],
  },
  {
    waveNumber: 14,
    prepTime: 300,
    groups: [
      { enemyType: 'Swarm-Drone',   count: 150, interval: 1, delay: 0 },
      { enemyType: 'Swarm-Runner',  count: 30,  interval: 1, delay: 0 },
      { enemyType: 'Cleanser-Pro',  count: 12,  interval: 5, delay: 0 },
      { enemyType: 'Tank-Fortress', count: 6,   interval: 12, delay: 0 },
    ],
  },
  {
    waveNumber: 15,
    prepTime: 300,
    groups: [
      // ── Lord-03 终局 (hp:12000, armor:10, speed:0.8) ─────────────────────
      { enemyType: 'Lord-03',      count: 1,   interval: 1, delay: 0  },
      { enemyType: 'Swarm-Drone',  count: 200, interval: 1, delay: 20 },
      { enemyType: 'Swarm-Runner', count: 40,  interval: 1, delay: 10 },
      { enemyType: 'Cleanser-Pro', count: 10,  interval: 6, delay: 25 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// L6 — 零域裁决（隐藏关，~3% 通关率）
// ─────────────────────────────────────────────────────────────────────────────
//
//  ██ 强制双人联机机制说明 ██
//
//  GameEngine: maxCapacity = playerCount × 10
//    - 单人：cap = 10
//    - 双人：cap = 20
//
//  本关仅 1 波，持续 1800 tick（= 180 秒 @ 100ms/tick）。
//  刷怪率：15 只 Swarm-Runner/秒 + 5 只 Tank-Fortress/秒
//
//  单人必败原因：
//    每秒 15 SWR（speed:2.5）+ 5 TF（hp:500, armor:15）入场。
//    单人 cap=10 → 超过 10 只存活时引擎触发 Overload（10 秒内
//    未清空会强制判负）。SWR+TF 混线，单人火力绝对无法在 1 秒
//    内输出足够 DPS 压制涌入速度，约 8 秒必定 Overload 崩溃。
//
//  双人可行原因：
//    cap=20，SWR 在 2 人交叉火力下约 0.4s 内可击杀（绕场容错）；
//    TF 需集中火力约 3s 击穿，双人轮流烧甲可维持节奏。
//    理论极限通关率约 3%。
//
//  刷怪拆解（WaveManager 并行组）：
//    Group A: Swarm-Runner, interval:1 → 10/sec（10 ticks/sec 基准）
//    Group B: Swarm-Runner, interval:2, delay:1 → +5/sec（错拍填缝）
//    Group C: Tank-Fortress, interval:2, delay:0 → 5/sec
//    → 合计 15 SWR/sec + 5 TF/sec ✓
//    → 最后一次刷怪约在第 1800 tick（180 秒）
//
// ─────────────────────────────────────────────────────────────────────────────

const level6Waves: WaveConfig[] = [
  {
    waveNumber: 1,
    // 准备时间 10 秒，给双人玩家协调布阵
    prepTime: 300,
    groups: [
      // ─ 高速流（15/sec）──────────────────────────────────────
      // Group A: 每 tick 1 只 → 10/sec, 持续 1800 tick
      { enemyType: 'Swarm-Runner', count: 1800, interval: 1, delay: 0 },
      // Group B: 每 2 tick 1 只，错拍 1 tick → +5/sec
      { enemyType: 'Swarm-Runner', count: 900,  interval: 2, delay: 1 },

      // ─ 精英重装流（5/sec）──────────────────────────────────
      // Group C: 每 2 tick 1 只 → 5/sec, 持续 1800 tick
      { enemyType: 'Tank-Fortress', count: 900, interval: 2, delay: 0 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 常量字典（供 GameEngine / ProgressStore / 前端 UI 调用）
// ─────────────────────────────────────────────────────────────────────────────

export const LEVEL_CONFIGS: Readonly<Record<number, LevelConfig>> = {
  0: {
    levelId: 0,
    label: '新人引导场',
    description: '专为碳基新手设计的教学体验。极慢出怪速度，充足的金币让你随意尝试建塔。',
    targetClearRate: 1.0,
    allowedPlayerKinds: ['human'],
    startingGold: 800,
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: level0Waves,
  },
  1: {
    levelId: 1,
    label: '基础心智试炼',
    description: '验证基础伤害覆盖与攻击间距。少量高移速 Speedster 会突破低射速炮阵。',
    targetClearRate: 0.5,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: level1Waves,
  },
  2: {
    levelId: 2,
    label: '护甲机制引入',
    description: 'Tank 系高护甲部队倒逼你升级或建造电塔。纯物理炮阵将在本关崩溃。',
    targetClearRate: 0.4,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: level2Waves,
  },
  3: {
    levelId: 3,
    label: '虫群机制引入',
    description: '大规模 Swarm-Drone 压制测试你的 AOE 覆盖率。Wave 10 有 Lord-01 压场。',
    targetClearRate: 0.3,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: level3Waves,
  },
  4: {
    levelId: 4,
    label: '复合精英压迫',
    description: 'Shielded + Cleanser 组合要求在净化间隙打爆护盾。Wave 12 迎战 Lord-02。',
    targetClearRate: 0.2,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: level4Waves,
  },
  5: {
    levelId: 5,
    label: '算力深渊',
    description: '全类型混搭的排行榜竞技关。Wave 15 Lord-03 与满屏虫群同时在场。',
    targetClearRate: 0.1,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 1,
    capacityPerPlayer: 10,
    waves: level5Waves,
  },
  6: {
    levelId: 6,
    label: '零域裁决',
    description:
      '【隐藏关】强制双人联机。单人 cap=10，8 秒内必触发 Overload 崩溃。'
      + '每秒涌入 15 只极速体 + 5 只高甲重装，180 秒持续压制。',
    targetClearRate: 0.03,
    allowedPlayerKinds: ['human', 'agent'],
    minPlayers: 2,
    capacityPerPlayer: 10,
    waves: level6Waves,
  },
} as const

/** 按照关卡顺序排列的 levelId 列表（不含隐藏关 6） */
export const ORDERED_STANDARD_LEVEL_IDS: readonly number[] = [0, 1, 2, 3, 4, 5] as const

/** 全部关卡 ID（含隐藏关） */
export const ALL_LEVEL_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6] as const

/**
 * 根据 levelId 获取 WaveConfig[]，供 GameEngine / WaveManager 直接使用。
 * 若 levelId 无效则返回 null。
 */
export function getWavesForLevel(levelId: number): WaveConfig[] | null {
  return LEVEL_CONFIGS[levelId]?.waves ?? null
}
