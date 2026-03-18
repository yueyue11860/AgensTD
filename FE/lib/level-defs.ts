/**
 * FE 侧关卡定义常量
 *
 * clearRate: 目标通关率 (0-1)，仅供 UI 展示
 * danger:    是否为极危关（L6），触发猩红闪烁特效
 * hidden:    是否为隐藏关，需满足特殊条件才解锁
 */

export interface LevelDef {
  levelId: number
  label: string
  /** 第二行副标题 */
  subtitle: string
  /** 目标通关率，0-1 */
  clearRate: number
  /** 推荐最低参与人数 */
  minPlayers: number
  /** 仅部分关卡限制玩家类型 */
  allowedPlayerKinds: Array<'human' | 'agent'>
  hidden: boolean
  danger: boolean
}

export const LEVEL_DEFS: readonly LevelDef[] = [
  {
    levelId: 0,
    label: '新人引导场',
    subtitle: '教学关 · 仅碳基可用',
    clearRate: 1.0,
    minPlayers: 1,
    allowedPlayerKinds: ['human'],
    hidden: false,
    danger: false,
  },
  {
    levelId: 1,
    label: '基础心智试炼',
    subtitle: '5 波 · 速度压制初测',
    clearRate: 0.5,
    minPlayers: 1,
    allowedPlayerKinds: ['human', 'agent'],
    hidden: false,
    danger: false,
  },
  {
    levelId: 2,
    label: '护甲机制引入',
    subtitle: '8 波 · 破甲布阵',
    clearRate: 0.4,
    minPlayers: 1,
    allowedPlayerKinds: ['human', 'agent'],
    hidden: false,
    danger: false,
  },
  {
    levelId: 3,
    label: '虫群机制引入',
    subtitle: '10 波 · AOE 清场',
    clearRate: 0.3,
    minPlayers: 1,
    allowedPlayerKinds: ['human', 'agent'],
    hidden: false,
    danger: false,
  },
  {
    levelId: 4,
    label: '复合精英压迫',
    subtitle: '12 波 · 单体爆发',
    clearRate: 0.2,
    minPlayers: 1,
    allowedPlayerKinds: ['human', 'agent'],
    hidden: false,
    danger: false,
  },
  {
    levelId: 5,
    label: '算力深渊',
    subtitle: '15 波 · 排行榜竞技',
    clearRate: 0.1,
    minPlayers: 1,
    allowedPlayerKinds: ['human', 'agent'],
    hidden: false,
    danger: false,
  },
  {
    levelId: 6,
    label: '零域裁决',
    subtitle: '极度危险 | 强制多人协同',
    clearRate: 0.03,
    minPlayers: 2,
    allowedPlayerKinds: ['human', 'agent'],
    hidden: true,
    danger: true,
  },
] as const

/** 解锁 L6 所需的 Level 5 通关次数（与 BE 的 HIDDEN_LEVEL_UNLOCK_COUNT 同步） */
export const L6_UNLOCK_THRESHOLD = 5
